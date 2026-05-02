import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  View, Text, FlatList, TouchableOpacity, Image, StyleSheet, 
  ActivityIndicator, RefreshControl, Alert, TextInput, ScrollView, Modal,
  Linking
} from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
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
import { colors, gradients, shadows, radius, spacing, typography, roleThemes, fontFamily } from '../theme';
import { useAuth } from '../context/AuthContext';

const ITEM_HEIGHT = 86;
const STATUS_OPTIONS = [
  { key: 'pending', label: 'Pending', bg: '#fef3c7', c: '#b45309', icon: 'clock' },
  { key: 'verified', label: 'Verified', bg: '#d1fae5', c: '#047857', icon: 'check' },
  { key: 'approved', label: 'Approved', bg: '#dbeafe', c: '#2563eb', icon: 'thumbs-up' },
  { key: 'download', label: 'Download', bg: '#ede9fe', c: '#7c3aed', icon: 'download' },
  { key: 'pool', label: 'Pool', bg: '#fce7f3', c: '#be185d', icon: 'archive' },
];

const EmptyList = React.memo(function EmptyList({ status }) {
  return (
    <View style={s.empty}>
      <View style={s.emptyIcon}><FontAwesome5 name="id-card" size={24} color={colors.gray300} /></View>
      <Text style={s.emptyTitle}>No {status} cards</Text>
      <Text style={s.emptySub}>Cards will appear here when available</Text>
    </View>
  );
});

export default function CardListScreen({ navigation, route }) {
  const { tableId, status: initialStatus } = route?.params || {};
  const { user } = useAuth();
  const theme = roleThemes[user?.role] || roleThemes.default;
  const [currentStatus, setCurrentStatus] = useState(initialStatus || 'pending');
  const statusDisplay = useMemo(() => (currentStatus || '').charAt(0).toUpperCase() + (currentStatus || '').slice(1), [currentStatus]);

  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [tableName, setTableName] = useState('');
  const [error, setError] = useState(null);
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });

  // Bulk select state
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [selectAllLoading, setSelectAllLoading] = useState(false);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilters, setActiveFilters] = useState({});
  const [showFilterDrawer, setShowFilterDrawer] = useState(false);
  const [totalCount, setTotalCount] = useState(0);

  // Form Modal state
  const [showForm, setShowForm] = useState(false);
  const [editingCardId, setEditingCardId] = useState(null);

  // Confirm Modal state
  const [confirmModal, setConfirmModal] = useState({ 
    visible: false, title: '', message: '', icon: '', color: colors.brandPrimary, onConfirm: null,
    statusFrom: '', statusTo: '', note: ''
  });

  // Table counts state
  const [tableCounts, setTableCounts] = useState({ pending: 0, verified: 0, approved: 0, download: 0, pool: 0, reprint: 0 });

  const loadTableCounts = useCallback(async () => {
    try {
      const { data } = await apiGet('/app/api/dashboard/');
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
      const { ok, data } = await apiGet(`/app/api/table/${tableId}/cards/`, params);
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
  }, [tableId, currentStatus, activeFilters, loadTableCounts]);

  useEffect(() => { loadCards(1); }, [loadCards]);

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
      setSelectedIds(new Set(cards.map(c => c.id)));
    }
  };

  const handleBulkStatus = async (newStatus) => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    setBulkLoading(true);
    try {
      const { data } = await apiPost(`/app/api/table/${tableId}/cards/bulk-status/`, {
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
      const { data } = await apiPost(`/app/api/card/${id}/status/`, { status: newStatus });
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
      const url = `${BASE_URL}/app/api/table/${tableId}/download-pdf/?status=${currentStatus}`;
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        Alert.alert(
          'Download PDF',
          `This will open your browser to download the ${currentStatus} cards as PDF. You may need to sign in if not already logged in in your browser.`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Download', onPress: () => Linking.openURL(url) }
          ]
        );
      } else {
        showToast('Cannot open download link', 'error');
      }
    } catch (e) {
      showToast('Error opening download', 'error');
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
          const { data } = await apiPost(`/app/api/card/${id}/delete/`, {});
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
    
    // Only confirm for serious transitions (e.g., verifying/approving)
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

  const onCardLongPress = useCallback((cardId) => {
    if (!selectMode) {
      setSelectMode(true);
      setSelectedIds(new Set([cardId]));
    }
  }, [selectMode]);

  const renderItem = useCallback(({ item }) => {
    const isSelected = selectedIds.has(item.id);
    return (
      <CardItem 
        item={item} 
        showCheckbox={selectMode}
        isSelected={isSelected}
        onToggleSelect={() => toggleSelection(item.id)}
        onEdit={() => { setEditingCardId(item.id); setShowForm(true); }}
        currentStatus={currentStatus}
        onStatusChange={(newStatus) => handleSingleStatusConfirm(item.id, newStatus)}
        onDelete={() => handleSingleDelete(item.id)}
      />
    );
  }, [selectedIds, toggleSelection, selectMode, navigation, tableId, currentStatus, handleSingleStatusConfirm, handleSingleDelete]);

  const keyExtractor = useCallback((item) => item.id.toString(), []);
  const getItemLayout = useCallback((_, index) => ({ length: ITEM_HEIGHT, offset: ITEM_HEIGHT * index, index }), []);

  const exitSelectMode = () => { setSelectMode(false); setSelectedIds(new Set()); };

  return (
    <View style={s.root}>
      <TopBar
        title={selectMode ? `${selectedIds.size} Selected` : `${statusDisplay} Lists`}
        subtitle={tableName || `Table #${tableId}`}
        onBack={selectMode ? exitSelectMode : () => navigation.goBack()}
        showHome={true}
        onAdd={() => { setEditingCardId(null); setShowForm(true); }}
        onDownload={handleDownloadPDF}
      >
        {/* Badges Bar (Inside Gradient) */}
        <View style={s.badgeBarWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.badgeBar}>
            {STATUS_OPTIONS.map(opt => {
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

        {/* Search Bar or Bulk Actions (Inside Gradient) */}
        {selectMode && selectedIds.size > 0 ? (
          <View style={s.bulkActionRow}>
            {currentStatus === 'pending' && user.permissions?.perm_idcard_verify && (
              <TouchableOpacity onPress={() => handleBulkStatus('verified')} disabled={bulkLoading} style={s.bulkBtn}>
                <FontAwesome5 name="check" size={12} color="#fff" />
                <Text style={s.bulkBtnText}>Verify</Text>
              </TouchableOpacity>
            )}
            {currentStatus === 'verified' && (
              <>
                {user.permissions?.perm_idcard_approve && (
                  <TouchableOpacity onPress={() => handleBulkStatus('approved')} disabled={bulkLoading} style={s.bulkBtn}>
                    <FontAwesome5 name="thumbs-up" size={12} color="#fff" />
                    <Text style={s.bulkBtnText}>Approve</Text>
                  </TouchableOpacity>
                )}
                {user.permissions?.perm_idcard_verify && (
                  <TouchableOpacity onPress={() => handleBulkStatus('pending')} disabled={bulkLoading} style={s.bulkBtn}>
                    <FontAwesome5 name="undo" size={12} color="#fff" />
                    <Text style={s.bulkBtnText}>Unverify</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
            {currentStatus === 'approved' && user.permissions?.perm_idcard_approve && (
              <TouchableOpacity onPress={() => handleBulkStatus('verified')} disabled={bulkLoading} style={s.bulkBtn}>
                <FontAwesome5 name="undo" size={12} color="#fff" />
                <Text style={s.bulkBtnText}>Unapprove</Text>
              </TouchableOpacity>
            )}
            {currentStatus === 'pool' && user.permissions?.perm_idcard_delete && (
              <TouchableOpacity onPress={() => handleBulkStatus('pending')} disabled={bulkLoading} style={s.bulkBtn}>
                <FontAwesome5 name="redo" size={12} color="#fff" />
                <Text style={s.bulkBtnText}>Restore</Text>
              </TouchableOpacity>
            )}
            {currentStatus !== 'pool' && user.permissions?.perm_idcard_delete && (
              <TouchableOpacity onPress={() => handleBulkStatus('pool')} disabled={bulkLoading} style={[s.bulkBtn, { backgroundColor: colors.red }]}>
                <FontAwesome5 name="trash-alt" size={12} color="#fff" />
                <Text style={s.bulkBtnText}>Delete</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <View style={s.searchRow}>
            <TouchableOpacity style={s.leftIconBtn} onPress={() => setShowFilterDrawer(true)} activeOpacity={0.7}>
              <FontAwesome5 name="filter" size={14} color="#fff" />
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
              <FontAwesome5 name="search" size={14} color="#fff" />
            </TouchableOpacity>
          </View>
        )}
      </TopBar>

      {/* Select All Row */}
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
                {selectMode && selectedIds.size > 0 && <FontAwesome5 name="check" size={8} color="#fff" />}
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

      <Toast visible={toast.visible} message={toast.message} type={toast.type} onHide={() => setToast(p => ({...p, visible: false}))} />

      <FilterDrawer 
        visible={showFilterDrawer}
        onClose={() => setShowFilterDrawer(false)}
        tableId={tableId}
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
  badgeBarWrap: { marginTop: 12, marginBottom: 12 },
  badgeBar: { paddingHorizontal: 16, gap: 6 },
  badgeBtn: { 
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8, 
    paddingVertical: 6, 
    borderRadius: radius.sm, 
    borderWidth: 1, 
    borderColor: 'rgba(255,255,255,0.1)',
    gap: 4
  },
  badgeBtnText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  countBadge: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: radius.xs,
    minWidth: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
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
  searchInput: { flex: 1, color: '#fff', fontSize: 13, paddingHorizontal: 8, fontWeight: '400', fontFamily: fontFamily.regular },
  bulkActionRow: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    marginHorizontal: 16, 
    marginBottom: 10, 
    gap: 8,
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
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  bulkBtnText: { color: '#fff', fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  selectAllRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.gray100, backgroundColor: '#fff' },
  selectAllBtn: { padding: 4 },
  selectAllContent: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkboxSmall: { width: 14, height: 14, borderRadius: 3, borderWidth: 1, borderColor: colors.gray300, alignItems: 'center', justifyContent: 'center' },
  checkboxCheckedSmall: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  selectAllText: { fontSize: 12, fontWeight: '600', color: colors.gray600 },
  recordsCountText: { fontSize: 11, color: colors.gray400, fontWeight: '500' },
  list: { padding: 16, paddingBottom: 100 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.gray50, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: 16, fontFamily: fontFamily.bold, color: colors.gray800, marginBottom: 4 },
  emptySub: { fontSize: 13, color: colors.gray400 },
  floatingSelectBarWrap: { position: 'absolute', bottom: 30, left: 20, right: 20, zIndex: 100 },
  floatingSelectBar: { flexDirection: 'column', paddingHorizontal: 20, paddingVertical: 14, borderRadius: radius.xl, ...shadows.xl, gap: 12 },
  selectionInfo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%' },
  selectionCount: { color: '#fff', fontSize: 14, fontWeight: '700' },
  floatingClearBtn: { backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.sm },
  floatingClearText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  floatingActions: { flexDirection: 'row', alignItems: 'center', gap: 10, width: '100%', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.15)', paddingTop: 10 },
  fActionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.15)', paddingVertical: 10, borderRadius: radius.md },
  fActionText: { color: '#fff', fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
});
