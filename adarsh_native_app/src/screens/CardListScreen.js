import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { 
  View, Text, FlatList, TouchableOpacity, StyleSheet, 
  ActivityIndicator, RefreshControl, TextInput, ScrollView,
  Linking
} from 'react-native';
import { DynamicIcon, IconPending, IconVerified, IconApproved, IconDownload, IconSearch, IconFilter, IconTrash, IconList, IconCheck } from '../components/Icons';
import { LinearGradient } from 'expo-linear-gradient';
import CardItem from '../components/CardItem';
import TopBar from '../components/TopBar';
import { CardListSkeleton } from '../components/Skeleton';
import { ErrorBanner } from '../components/NetworkGuard';
import Toast from '../components/Toast';
import CardModalForm from '../components/CardModalForm';
import ConfirmModal from '../components/ConfirmModal';
import FilterDrawer from '../components/FilterDrawer';
import { apiGet, apiPost, BASE_URL } from '../api/client';
import { colors, gradients, shadows, radius, fontFamily } from '../theme';
import { useAuth } from '../context/AuthContext';

const ITEM_HEIGHT = 86;
const STATUS_OPTIONS = [
  { key: 'pending', label: 'Pending', bg: '#fef3c7', c: '#b45309', icon: 'clock' },
  { key: 'verified', label: 'Verified', bg: '#d1fae5', c: '#047857', icon: 'check' },
  { key: 'approved', label: 'Approved', bg: '#dbeafe', c: '#2563eb', icon: 'thumbs-up' },
  { key: 'download', label: 'Download', bg: '#ede9fe', c: '#7c3aed', icon: 'download' },
  { key: 'pool', label: 'Pool', bg: '#fce7f3', c: '#be185d', icon: 'archive' },
  { key: 'reprint', label: 'Reprint', bg: '#fff7ed', c: '#ea580c', icon: 'redo' },
];

const EmptyList = React.memo(function EmptyList({ status }) {
  return (
    <View style={s.empty}>
      <View style={s.emptyIcon}><IconList size={24} color={colors.gray300} /></View>
      <Text style={s.emptyTitle}>No {status} cards</Text>
      <Text style={s.emptySub}>Cards will appear here when available</Text>
    </View>
  );
});

export default function CardListScreen({ navigation, route }) {
  const { tableId, status: initialStatus } = route?.params || {};
  const { user } = useAuth();

  const allowedStatuses = useMemo(() => {
    const perms = user?.permissions || {};
    return STATUS_OPTIONS.filter(opt => {
      const p = {
        pending: 'perm_idcard_pending_list',
        verified: 'perm_idcard_verified_list',
        approved: 'perm_idcard_approved_list',
        download: 'perm_idcard_download_list',
        pool: 'perm_idcard_pool_list',
        reprint: 'perm_idcard_reprint_list'
      }[opt.key];
      return (user?.isSuperAdmin) || !p || perms[p];
    });
  }, [user]);

  const [currentStatus, setCurrentStatus] = useState(() => {
    if (initialStatus && allowedStatuses.some(s => s.key === initialStatus)) return initialStatus;
    return allowedStatuses[0]?.key || 'pending';
  });

  const lastHandledStatus = React.useRef(initialStatus);

  useEffect(() => {
    if (initialStatus && initialStatus !== lastHandledStatus.current && allowedStatuses.some(s => s.key === initialStatus)) {
      setCurrentStatus(initialStatus);
      lastHandledStatus.current = initialStatus;
    }
  }, [initialStatus]);

  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [tableName, setTableName] = useState('');
  const [error, setError] = useState(null);
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [selectAllLoading, setSelectAllLoading] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilters, setActiveFilters] = useState({});
  const [showFilterDrawer, setShowFilterDrawer] = useState(false);
  const [totalCount, setTotalCount] = useState(0);

  const [showForm, setShowForm] = useState(false);
  const [editingCardId, setEditingCardId] = useState(null);

  const [confirmModal, setConfirmModal] = useState({ 
    visible: false, title: '', message: '', icon: '', color: colors.brandPrimary, onConfirm: null,
    statusFrom: '', statusTo: '', note: ''
  });

  const [tableCounts, setTableCounts] = useState({ pending: 0, verified: 0, approved: 0, download: 0, pool: 0, reprint: 0 });

  const loadTableCounts = useCallback(async () => {
    try {
      const { data } = await apiGet('/api/mobile/dashboard/');
      if (data?.success && data.data?.tables) {
        const t = data.data.tables.find(tbl => String(tbl.id) === String(tableId));
        if (t) {
          setTableCounts({
            pending: t.p || 0,
            verified: t.v || 0,
            approved: t.a || 0,
            download: t.d || 0,
            pool: t.po || 0,
            reprint: t.r || 0,
          });
        }
      }
    } catch (e) { }
  }, [tableId]);

  const perPage = 50;
  const showToast = (msg, type = 'info') => setToast({ visible: true, message: msg, type });

  const loadCards = useCallback(async (pageNum = 1, append = false, query = searchQuery) => {
    if (pageNum === 1) setLoading(true);
    else setLoadingMore(true);
    setError(null);
    try {
      const params = {
        status: currentStatus,
        page: pageNum,
        per_page: perPage,
        search: query,
        ...activeFilters
      };
      const { ok, data } = await apiGet(`/api/mobile/table/${tableId}/cards/`, params);
      if (ok && data?.success) {
        const newCards = data.data?.cards || [];
        setCards(prev => append ? [...prev, ...newCards] : newCards);
        setHasMore(newCards.length === perPage);
        setTableName(data.data?.table_name || '');
        setTotalCount(data.data?.total || 0);
        if (pageNum === 1) loadTableCounts();
      } else {
        setError(data?.message || 'Failed to load cards');
      }
    } catch (e) {
      setError('Network error - check your connection');
    }
    setLoading(false);
    setLoadingMore(false);
    setRefreshing(false);
  }, [tableId, currentStatus, activeFilters, searchQuery, loadTableCounts]);

  useFocusEffect(
    useCallback(() => {
      loadCards(1);
    }, [loadCards])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setPage(1);
    loadCards(1);
  }, [loadCards]);

  const loadMore = () => {
    if (hasMore && !loadingMore && !loading) {
      const nextPage = page + 1;
      setPage(nextPage);
      loadCards(nextPage, true);
    }
  };

  const toggleSelect = useCallback((id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSelectAll = async () => {
    if (selectedIds.size === cards.length && cards.length > 0) {
      setSelectedIds(new Set());
    } else {
      if (totalCount > cards.length) {
        setSelectAllLoading(true);
        try {
          const params = { status: currentStatus, search: searchQuery, ...activeFilters };
          const { ok, data } = await apiGet(`/api/mobile/table/${tableId}/cards/all-ids/`, params);
          if (ok && data?.success) {
            setSelectedIds(new Set(data.data?.ids || []));
          }
        } catch (e) { }
        setSelectAllLoading(false);
      } else {
        setSelectedIds(new Set(cards.map(c => c.id)));
      }
    }
  };

  const handleBulkStatus = async (newStatus) => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    setBulkLoading(true);
    try {
      const { data } = await apiPost(`/api/mobile/table/${tableId}/cards/bulk-status/`, {
        card_ids: ids,
        status: newStatus
      });
      if (data?.success) {
        showToast(data.message || 'Status updated', 'success');
        setPage(1);
        loadCards(1);
        exitSelectMode();
      } else {
        showToast(data?.message || 'Failed', 'error');
      }
    } catch (e) { showToast('Network error', 'error'); }
    setBulkLoading(false);
  };

  const handleSingleStatus = async (id, newStatus) => {
    try {
      const { data } = await apiPost(`/api/mobile/card/${id}/status/`, { status: newStatus });
      if (data?.success) {
        showToast(data.message || 'Status updated', 'success');
        setCards(prev => prev.filter(c => c.id !== id));
        loadTableCounts();
      } else {
        showToast(data?.message || 'Failed', 'error');
      }
    } catch (e) { showToast('Network error', 'error'); }
  };

  const handleDownloadPDF = async () => {
    try {
      let url = `${BASE_URL}/api/mobile/table/${tableId}/download-pdf/?status=${currentStatus}`;
      
      if (selectedIds.size > 0) {
        url += `&selected_ids=${Array.from(selectedIds).join(',')}`;
      } else {
        if (searchQuery) url += `&search=${encodeURIComponent(searchQuery)}`;
        if (activeFilters.class) url += `&class=${encodeURIComponent(activeFilters.class)}`;
        if (activeFilters.section) url += `&section=${encodeURIComponent(activeFilters.section)}`;
        if (activeFilters.photo) url += `&photo=${encodeURIComponent(activeFilters.photo)}`;
      }
      
      await Linking.openURL(url);
    } catch (e) {
      showToast('Could not open download link', 'error');
    }
  };

  const handleSingleDelete = (id) => {
    setConfirmModal({
      visible: true,
      title: 'Move to Pool?',
      message: 'Are you sure you want to remove this card? It will be moved to the pool.',
      icon: 'archive',
      color: '#be185d',
      statusFrom: currentStatus,
      statusTo: 'pool',
      note: 'Cards in the pool can be retrieved later.',
      onConfirm: async () => {
        setBulkLoading(true);
        setConfirmModal(p => ({ ...p, visible: false }));
        try {
          const { data } = await apiPost(`/api/mobile/card/${id}/delete/`, {});
          if (data?.success) { 
            showToast('Moved to pool', 'success'); 
            setCards(prev => prev.filter(c => c.id !== id));
            loadTableCounts();
          }
          else showToast(data?.message || 'Failed', 'error');
        } catch (e) { showToast('Network error', 'error'); }
        setBulkLoading(false);
      }
    });
  };

  const handleSingleStatusConfirm = (id, newStatus) => {
    const opt = STATUS_OPTIONS.find(o => o.key === newStatus);
    const label = opt?.label || newStatus;
    
    if (newStatus === 'pending' || newStatus === 'download') {
      handleSingleStatus(id, newStatus);
      return;
    }

    setConfirmModal({
      visible: true,
      title: `${label} Card?`,
      message: `Do you want to change this card's status to ${label}?`,
      icon: opt?.icon || 'check',
      color: opt?.c || colors.brandPrimary,
      statusFrom: currentStatus,
      statusTo: newStatus,
      note: `This will move the card to the ${label} list.`,
      onConfirm: async () => {
        setConfirmModal(p => ({ ...p, visible: false }));
        handleSingleStatus(id, newStatus);
      }
    });
  };

  const exitSelectMode = () => { setSelectMode(false); setSelectedIds(new Set()); };

  const renderItem = useCallback(({ item }) => {
    const isSelected = selectedIds.has(item.id);
    const perms = user?.permissions || {};
    return (
      <CardItem 
        item={item} 
        showCheckbox={selectMode}
        isSelected={isSelected}
        onToggleSelect={() => toggleSelect(item.id)}
        onEdit={perms.perm_idcard_edit ? () => { setEditingCardId(item.id); setShowForm(true); } : undefined}
        currentStatus={currentStatus}
        onStatusChange={(newStatus) => handleSingleStatusConfirm(item.id, newStatus)}
        onDelete={perms.perm_idcard_delete ? () => handleSingleDelete(item.id) : undefined}
        permissions={perms}
      />
    );
  }, [selectedIds, toggleSelect, selectMode, currentStatus, handleSingleStatusConfirm, handleSingleDelete, user]);
  const keyExtractor = useCallback((item) => item.id.toString(), []);

  return (
    <View style={s.root}>
      <TopBar 
        title={selectMode ? `${selectedIds.size} Selected` : `${currentStatus.charAt(0).toUpperCase() + currentStatus.slice(1)} Cards`} 
        subtitle={tableName || `List ID: #${tableId}`}
        onBack={selectMode ? exitSelectMode : () => navigation.goBack()} 
        showHome={true}
        onAdd={(tableId && (user?.permissions?.perm_idcard_add || user?.permissions?.perm_idcard_create || user?.permissions?.perm_add_card)) ? () => { setEditingCardId(null); setShowForm(true); } : undefined}
        onDownload={handleDownloadPDF}
      >
        <View style={s.badgeBarWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.badgeBar}>
            {allowedStatuses.map(opt => {
              const isActive = currentStatus === opt.key;
              return (
                <TouchableOpacity
                  key={opt.key}
                  onPress={() => { setCurrentStatus(opt.key); setPage(1); setCards([]); }}
                  style={[
                    s.badgeBtn, 
                    { 
                      backgroundColor: isActive ? opt.c : opt.bg, 
                      borderColor: isActive ? opt.c : opt.bg 
                    }
                  ]}
                  activeOpacity={0.8}
                >
                  <Text style={[
                    s.badgeBtnText, 
                    { color: isActive ? '#fff' : opt.c }
                  ]}>
                    {opt.label}
                  </Text>
                  <View style={[
                    s.countBadge,
                    { backgroundColor: isActive ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.05)' }
                  ]}>
                    <Text style={[
                      s.countBadgeText,
                      { color: isActive ? '#fff' : opt.c }
                    ]}>{tableCounts[opt.key] || 0}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        <View style={s.searchRow}>
          <TouchableOpacity style={s.leftIconBtn} onPress={() => setShowFilterDrawer(true)} activeOpacity={0.7}>
            <IconFilter size={14} color="#fff" />
          </TouchableOpacity>
          <TextInput
            style={s.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search cards..."
            placeholderTextColor="rgba(255,255,255,0.5)"
            returnKeyType="search"
            onSubmitEditing={() => { setPage(1); loadCards(1); }}
          />
          <TouchableOpacity style={s.rightIconBtn} onPress={() => { setPage(1); loadCards(1); }} activeOpacity={0.7}>
            <IconSearch size={14} color="#fff" />
          </TouchableOpacity>
        </View>
      </TopBar>

      <View style={s.selectAllRow}>
        <TouchableOpacity 
          style={s.selectAllBtn} 
          onPress={() => { if (!selectMode) setSelectMode(true); handleSelectAll(); }}
          disabled={selectAllLoading}
          activeOpacity={0.7}
        >
          {selectAllLoading ? (
            <ActivityIndicator size="small" color={colors.brandPrimary} />
          ) : (
            <View style={s.selectAllContent}>
              <View style={[s.checkboxSmall, selectMode && selectedIds.size > 0 && s.checkboxCheckedSmall]}>
                {selectMode && selectedIds.size > 0 && <DynamicIcon name="check" size={8} color="#fff" />}
              </View>
              <Text style={s.selectAllText}>Select All</Text>
            </View>
          )}
        </TouchableOpacity>
        <Text style={s.recordsCountText}>Showing {totalCount} records</Text>
      </View>

      {error && <ErrorBanner message={error} onRetry={() => loadCards(1)} onDismiss={() => setError(null)} />}
      {loading ? (
        <CardListSkeleton />
      ) : (
        <FlatList
          data={cards}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandLight} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          removeClippedSubviews={true}
          maxToRenderPerBatch={15}
          windowSize={11}
          initialNumToRender={12}
          updateCellsBatchingPeriod={50}
          ListFooterComponent={loadingMore && cards.length > 0 ? <ActivityIndicator style={{ padding: 16 }} color={colors.brandLight} /> : null}
          ListEmptyComponent={<EmptyList status={currentStatus} />}
        />
      )}

      {/* Floating Selection Bar */}
      {selectMode && selectedIds.size > 0 && (
        <View style={s.floatingSelectBarWrap}>
          <LinearGradient colors={gradients.brandFull} start={{x:0, y:0}} end={{x:1, y:1}} style={s.floatingSelectBar}>
            <View style={s.selectionInfo}>
              <Text style={s.selectionCount}>{selectedIds.size} Selected</Text>
              <TouchableOpacity onPress={exitSelectMode} style={s.floatingClearBtn}>
                <Text style={s.floatingClearText}>CLEAR</Text>
              </TouchableOpacity>
            </View>
            
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.floatingActions}>
              {currentStatus === 'pending' && user?.permissions?.perm_idcard_verify && (
                <TouchableOpacity onPress={() => handleBulkStatus('verified')} disabled={bulkLoading} style={s.fActionBtn}>
                  <IconCheck size={13} color="#fff" style={{ marginRight: 6 }} />
                  <Text style={s.fActionText}>Verify</Text>
                </TouchableOpacity>
              )}
              {currentStatus === 'verified' && (
                <>
                  {user?.permissions?.perm_idcard_approve && (
                    <TouchableOpacity onPress={() => handleBulkStatus('approved')} disabled={bulkLoading} style={s.fActionBtn}>
                      <IconVerified size={13} color="#fff" style={{ marginRight: 6 }} />
                      <Text style={s.fActionText}>Approve</Text>
                    </TouchableOpacity>
                  )}
                  {user?.permissions?.perm_idcard_verify && (
                    <TouchableOpacity onPress={() => handleBulkStatus('pending')} disabled={bulkLoading} style={s.fActionBtn}>
                      <IconPending size={13} color="#fff" style={{ marginRight: 6 }} />
                      <Text style={s.fActionText}>Unverify</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}
              {currentStatus === 'approved' && user?.permissions?.perm_idcard_approve && (
                <TouchableOpacity onPress={() => handleBulkStatus('verified')} disabled={bulkLoading} style={s.fActionBtn}>
                  <IconPending size={13} color="#fff" style={{ marginRight: 6 }} />
                  <Text style={s.fActionText}>Unapprove</Text>
                </TouchableOpacity>
              )}
              {currentStatus === 'pool' && user?.permissions?.perm_idcard_delete && (
                <TouchableOpacity onPress={() => handleBulkStatus('pending')} disabled={bulkLoading} style={s.fActionBtn}>
                  <IconPending size={13} color="#fff" style={{ marginRight: 6 }} />
                  <Text style={s.fActionText}>Restore</Text>
                </TouchableOpacity>
              )}
              {currentStatus !== 'pool' && user?.permissions?.perm_idcard_delete && (
                <TouchableOpacity onPress={() => handleBulkStatus('pool')} disabled={bulkLoading} style={[s.fActionBtn, { backgroundColor: 'rgba(239, 68, 68, 0.4)' }]}>
                  <IconTrash size={13} color="#fff" style={{ marginRight: 6 }} />
                  <Text style={s.fActionText}>Delete</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={handleDownloadPDF} style={s.fActionBtn}>
                <IconDownload size={13} color="#fff" style={{ marginRight: 6 }} />
                <Text style={s.fActionText}>Export</Text>
              </TouchableOpacity>
            </ScrollView>
          </LinearGradient>
        </View>
      )}

      <Toast visible={toast.visible} message={toast.message} type={toast.type} onHide={() => setToast(p => ({...p, visible: false}))} />

      <FilterDrawer 
        visible={showFilterDrawer}
        onClose={() => setShowFilterDrawer(false)}
        tableId={tableId}
        status={currentStatus}
        currentFilters={activeFilters}
        onApply={(filters) => {
          setActiveFilters(filters);
          setPage(1);
          // loadCards will be triggered by useEffect dependency
        }}
      />

      {/* Dynamic Form Drawer */}
      <CardModalForm 
        visible={showForm} 
        onClose={() => setShowForm(false)} 
        tableId={tableId}
        cardId={editingCardId}
        onSuccess={onRefresh}
      />

      {/* Confirmation Modal */}
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
        loading={bulkLoading}
      />


    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceBg },
  listC: { padding: 12, paddingBottom: 100 },
  card: { backgroundColor: '#fff', borderRadius: radius.md, marginBottom: 12, overflow: 'hidden', borderWidth: 1, borderColor: colors.gray100, ...shadows.sm },
  cardContent: { flexDirection: 'row', padding: 10 },
  photoBox: { width: 70, height: 90, borderRadius: radius.xs, backgroundColor: colors.gray50, overflow: 'hidden', borderWidth: 1, borderColor: colors.gray100 },
  photo: { width: '100%', height: '100%' },
  info: { flex: 1, marginLeft: 12, justifyContent: 'center' },
  name: { fontSize: 15, fontFamily: fontFamily.bold, color: colors.gray800, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 3 },
  rowLabel: { fontSize: 10, fontFamily: fontFamily.bold, color: colors.gray400, width: 60, textTransform: 'uppercase' },
  rowVal: { fontSize: 11, fontFamily: fontFamily.semibold, color: colors.gray600, flex: 1 },
  
  cardActions: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#f8fafc', backgroundColor: '#fafafa', paddingHorizontal: 10, paddingVertical: 8, justifyContent: 'flex-end' },
  actionBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.sm, flexDirection: 'row', alignItems: 'center' },
  actionText: { fontSize: 11, fontFamily: fontFamily.bold, color: '#fff' },

  selectIcon: { position: 'absolute', top: 8, right: 8, zIndex: 10 },
  selectedCard: { borderColor: colors.brandPrimary, borderWidth: 1.5, backgroundColor: '#fdf4ff' },

  empty: { padding: 80, alignItems: 'center' },
  emptyText: { marginTop: 12, color: colors.gray400, fontSize: 14, fontFamily: fontFamily.medium },

  // Floating Selection Bar
  selectionBar: { position: 'absolute', bottom: 30, left: 16, right: 16, height: 65, borderRadius: radius.lg, overflow: 'hidden', ...shadows.xl },
  selectionBarBlur: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  selectionInfo: { flex: 1 },
  selectionCount: { fontSize: 14, fontFamily: fontFamily.black, color: '#fff' },
  selectionText: { fontSize: 10, fontFamily: fontFamily.bold, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase' },
  selectionActions: { flexDirection: 'row' },
  selectionBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  
  badgeBarWrap: { marginTop: 12, marginBottom: 12 },
  badgeBar: { paddingHorizontal: 16 },
  badgeBtn: { 
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8, 
    paddingVertical: 6, 
    borderRadius: radius.sm, 
    borderWidth: 1, 
    borderColor: 'rgba(255,255,255,0.1)',
    
  },
  badgeBtnText: { fontSize: 10, fontFamily: fontFamily.bold, textTransform: 'uppercase' },
  countBadge: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: radius.xs,
    minWidth: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadgeText: { color: '#fff', fontSize: 9, fontFamily: fontFamily.bold },
  searchRow: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: 'rgba(255,255,255,0.15)', 
    borderRadius: radius.md, 
    marginHorizontal: 16, 
    marginBottom: 10, 
    paddingHorizontal: 12, 
    height: 44,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  leftIconBtn: { padding: 4 },
  rightIconBtn: { padding: 4 },
  searchInput: { flex: 1, color: '#fff', fontSize: 13, paddingHorizontal: 8, fontFamily: fontFamily.regular },
  bulkActionRow: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    marginHorizontal: 16, 
    marginBottom: 10, 
    
    height: 44,
  },
  bulkBtn: { 
    flex: 1,
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)', 
    borderRadius: radius.md, 
    height: '100%',
    
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  bulkBtnText: { color: '#fff', fontSize: 10, fontFamily: fontFamily.bold, marginLeft: 6 },
  floatingSelectBarWrap: {
    position: 'absolute',
    bottom: 20,
    left: 16,
    right: 16,
    zIndex: 1000,
    ...shadows.lg,
  },
  floatingSelectBar: {
    borderRadius: radius.xl,
    padding: 12,
    flexDirection: 'column',
    overflow: 'hidden',
  },
  selectionInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  selectionCount: {
    color: '#fff',
    fontSize: 14,
    fontFamily: fontFamily.bold,
  },
  floatingClearBtn: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  floatingClearText: {
    color: '#fff',
    fontSize: 10,
    fontFamily: fontFamily.bold,
  },
  floatingActions: {
    flexDirection: 'row',
    alignItems: 'center',
    
  },
  fActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.md,
    
  },
  fActionText: {
    color: '#fff',
    fontSize: 12,
    fontFamily: fontFamily.bold,
  },
  selectAllRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.gray100, backgroundColor: '#fff' },
  selectAllBtn: { padding: 4 },
  selectAllContent: { flexDirection: 'row', alignItems: 'center' },
  checkboxSmall: { width: 14, height: 14, borderRadius: 3, borderWidth: 1, borderColor: colors.gray300, alignItems: 'center', justifyContent: 'center' },
  checkboxCheckedSmall: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  selectAllText: { fontSize: 12, fontFamily: fontFamily.semibold, color: colors.gray600 },
  recordsCountText: { fontSize: 11, color: colors.gray400, fontFamily: fontFamily.medium },
  list: { padding: 12, paddingBottom: 100 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.gray50, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: 16, fontFamily: fontFamily.bold, color: colors.gray800, marginBottom: 4 },
  emptySub: { fontSize: 13, color: colors.gray400, fontFamily: fontFamily.regular },
});
