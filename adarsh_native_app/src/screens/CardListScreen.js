import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { 
  View, Text, FlatList, TouchableOpacity, StyleSheet, 
  ActivityIndicator, RefreshControl, TextInput, ScrollView,
  Dimensions, Keyboard
} from 'react-native';
import { DynamicIcon, IconPending, IconVerified, IconApproved, IconDownload, IconSearch, IconFilter, IconTrash, IconList, IconCheck, IconRedo } from '../components/Icons';
import { LinearGradient } from 'expo-linear-gradient';
import CardItem from '../components/CardItem';
import TopBar from '../components/TopBar';
import { CardListSkeleton } from '../components/Skeleton';
import { ErrorBanner } from '../components/NetworkGuard';
import Toast from '../components/Toast';
import CardModalForm from '../components/CardModalForm';
import ConfirmModal from '../components/ConfirmModal';
import FilterDrawer from '../components/FilterDrawer';
import { apiGet, apiPost } from '../api/client';
import { colors, gradients, shadows, radius, fontFamily } from '../theme';
import { useAuth } from '../context/AuthContext';

const { width } = Dimensions.get('window');

const STATUS_OPTIONS = [
  { key: 'pending', label: 'Pending', bg: '#fffbeb', c: '#f59e0b', icon: 'clock' },
  { key: 'verified', label: 'Verified', bg: '#ecfdf5', c: '#10b981', icon: 'check' },
  { key: 'approved', label: 'Approved', bg: '#eff6ff', c: '#3b82f6', icon: 'thumbs-up' },
  { key: 'download', label: 'Download', bg: '#f5f3ff', c: '#8b5cf6', icon: 'download' },
  { key: 'pool', label: 'Pool', bg: '#fef2f2', c: '#ef4444', icon: 'archive' },
];

export default function CardListScreen({ navigation, route }) {
  const { tableId, status: initialStatus } = route?.params || {};
  const { user } = useAuth();
  const perms = useMemo(() => user?.permissions || {}, [user]);

  const allowedStatuses = useMemo(() => {
    return STATUS_OPTIONS.filter(opt => {
      const p = {
        pending: 'perm_idcard_pending_list',
        verified: 'perm_idcard_verified_list',
        approved: 'perm_idcard_approved_list',
        download: 'perm_idcard_download_list',
        pool: 'perm_idcard_pool_list'
      }[opt.key];
      return (user?.isSuperAdmin) || !p || perms[p];
    });
  }, [user, perms]);

  const [currentStatus, setCurrentStatus] = useState(() => {
    if (initialStatus && allowedStatuses.some(s => s.key === initialStatus)) return initialStatus;
    return allowedStatuses[0]?.key || 'pending';
  });

  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [tableName, setTableName] = useState('');
  const [tableCounts, setTableCounts] = useState({});
  const [error, setError] = useState(null);
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilters, setActiveFilters] = useState({});
  const [showFilterDrawer, setShowFilterDrawer] = useState(false);
  const [totalCount, setTotalCount] = useState(0);

  const [showForm, setShowForm] = useState(false);
  const [editingCardId, setEditingCardId] = useState(null);

  const [confirmModal, setConfirmModal] = useState({ 
    visible: false, title: '', message: '', icon: '', color: colors.brandPrimary, onConfirm: null,
    statusFrom: '', statusTo: ''
  });

  const showToast = (message, type = 'info') => setToast({ visible: true, message, type });

  const loadCards = useCallback(async (pageNum = 1, append = false) => {
    if (pageNum === 1) setLoading(true);
    else setLoadingMore(true);

    try {
      const params = { page: pageNum, status: currentStatus, search: searchQuery, ...activeFilters };
      const { ok, data } = await apiGet(`/api/mobile/table/${tableId}/cards/`, params);
      
      if (ok && data?.success) {
        setCards(prev => append ? [...prev, ...(data.data?.cards || [])] : (data.data?.cards || []));
        setHasMore(data.data?.has_more || false);
        setTableName(data.data?.table_name || '');
        setTotalCount(data.data?.total || 0);
        setTableCounts(data.data?.counts || {});
      } else setError(data?.message || 'Failed to load cards');
    } catch (e) { setError('Network error'); }
    finally { setLoading(false); setLoadingMore(false); setRefreshing(false); }
  }, [tableId, currentStatus, searchQuery, activeFilters]);

  useFocusEffect(useCallback(() => { loadCards(1); }, [loadCards]));

  const onRefresh = () => { setRefreshing(true); setPage(1); loadCards(1); };
  const loadMore = () => { if (hasMore && !loadingMore && !loading) { const next = page + 1; setPage(next); loadCards(next, true); } };

  const toggleSelect = useCallback((id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (next.size > 0) setSelectMode(true);
      else setSelectMode(false);
      return next;
    });
  }, []);

  const handleSelectAll = () => {
    if (selectedIds.size === cards.length && cards.length > 0) {
      setSelectedIds(new Set());
      setSelectMode(false);
    } else {
      setSelectedIds(new Set(cards.map(c => c.id)));
      setSelectMode(true);
    }
  };

  const exitSelectMode = () => { setSelectMode(false); setSelectedIds(new Set()); };

  const handleBulkStatus = async (newStatus) => {
    if (selectedIds.size === 0) return;
    setBulkLoading(true);
    try {
      const { data } = await apiPost(`/api/mobile/table/${tableId}/bulk-status/`, {
        card_ids: Array.from(selectedIds),
        status: newStatus
      });
      if (data?.success) {
        showToast(data.message || 'Updated successfully', 'success');
        onRefresh();
        exitSelectMode();
      } else showToast(data?.message || 'Update failed', 'error');
    } catch (e) { showToast('Network error', 'error'); }
    finally { setBulkLoading(false); }
  };

  const handleSingleStatus = async (id, newStatus) => {
    try {
      const { data } = await apiPost(`/api/mobile/card/${id}/status/`, { status: newStatus });
      if (data?.success) {
        showToast(data.message || 'Updated', 'success');
        onRefresh();
      } else showToast(data?.message || 'Failed', 'error');
    } catch (e) { showToast('Network error', 'error'); }
  };

  const handleSingleDelete = (id) => {
    setConfirmModal({
      visible: true, title: 'Delete Card?', message: 'Move to Pool list?', icon: 'trash', color: colors.red,
      statusFrom: currentStatus, statusTo: 'pool',
      onConfirm: async () => {
        setConfirmModal(p => ({ ...p, visible: false }));
        try {
          const { data } = await apiPost(`/api/mobile/card/${id}/delete/`, {});
          if (data?.success) { showToast('Moved to Pool', 'success'); onRefresh(); }
          else showToast(data?.message || 'Failed', 'error');
        } catch (e) { showToast('Network error', 'error'); }
      }
    });
  };

  const handleStatusChange = (id, newStatus) => {
    const opt = STATUS_OPTIONS.find(o => o.key === newStatus);
    setConfirmModal({
      visible: true, title: `${opt?.label} Card?`, message: `Move to the ${opt?.label} list?`, icon: opt?.icon || 'check', color: opt?.c || colors.brandPrimary,
      statusFrom: currentStatus, statusTo: newStatus,
      onConfirm: () => { setConfirmModal(p => ({ ...p, visible: false })); handleSingleStatus(id, newStatus); }
    });
  };

  const renderItem = useCallback(({ item }) => (
    <CardItem 
      item={item} 
      showCheckbox={selectMode}
      isSelected={selectedIds.has(item.id)}
      onToggleSelect={() => toggleSelect(item.id)}
      onEdit={perms.perm_idcard_edit ? () => { setEditingCardId(item.id); setShowForm(true); } : undefined}
      currentStatus={currentStatus}
      onStatusChange={(s) => handleStatusChange(item.id, s)}
      onDelete={perms.perm_idcard_delete ? () => handleSingleDelete(item.id) : undefined}
      permissions={perms}
    />
  ), [selectMode, selectedIds, perms, currentStatus, toggleSelect]);

  return (
    <View style={s.root}>
      <TopBar title={selectMode ? `${selectedIds.size} SELECTED` : `${currentStatus.toUpperCase()} LIST`} subtitle={tableName} onBack={selectMode ? exitSelectMode : () => navigation.goBack()}
        onAdd={perms.perm_idcard_add ? () => { setEditingCardId(null); setShowForm(true); } : undefined} />

      <View style={s.tabContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabScroll}>
          {allowedStatuses.map(opt => (
            <TouchableOpacity key={opt.key} onPress={() => { setCurrentStatus(opt.key); setPage(1); }} style={[s.tabItem, currentStatus === opt.key && { backgroundColor: opt.c, borderColor: opt.c }]}>
              <Text style={[s.tabLabel, { color: currentStatus === opt.key ? '#fff' : opt.c }]}>{opt.label}</Text>
              <View style={[s.tabCount, { backgroundColor: currentStatus === opt.key ? 'rgba(255,255,255,0.2)' : `${opt.c}15` }]}>
                <Text style={[s.tabCountText, { color: currentStatus === opt.key ? '#fff' : opt.c }]}>{tableCounts[opt.key] || 0}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <View style={s.headerActions}>
        <View style={s.searchWrap}>
          <IconSearch size={14} color={colors.gray400} />
          <TextInput style={s.searchInput} placeholder="Search name, roll, mobile..." value={searchQuery} onChangeText={setSearchQuery} returnKeyType="search" onSubmitEditing={() => loadCards(1)} />
        </View>
        <TouchableOpacity onPress={() => setShowFilterDrawer(true)} style={s.filterBtn}><DynamicIcon name="filter" size={14} color={colors.brandPrimary} style={{ marginRight: 6 }} /><Text style={s.filterBtnText}>FILTER</Text></TouchableOpacity>
      </View>

      <View style={s.summaryRow}>
        <TouchableOpacity style={s.selectAllBtn} onPress={handleSelectAll}>
          <View style={[s.checkboxSmall, selectedIds.size > 0 && s.checkboxCheckedSmall]}>{selectedIds.size > 0 && <IconCheck size={8} color="#fff" />}</View>
          <Text style={s.selectAllText}>{selectedIds.size === cards.length ? 'DESELECT ALL' : 'SELECT ALL'}</Text>
        </TouchableOpacity>
        <Text style={s.totalText}>{totalCount} RECORDS</Text>
      </View>

      {error ? <ErrorBanner message={error} onRetry={() => loadCards(1)} /> : loading ? <CardListSkeleton /> : (
        <FlatList data={cards} renderItem={renderItem} keyExtractor={item => item.id.toString()} contentContainerStyle={s.list} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandPrimary} />} onEndReached={loadMore} onEndReachedThreshold={0.5} ListFooterComponent={loadingMore ? <ActivityIndicator style={{padding:20}} color={colors.brandPrimary} /> : null} ListEmptyComponent={<View style={s.empty}><Text style={s.emptyText}>No cards found</Text></View>} />
      )}

      {selectMode && (
        <View style={s.floatingBar}>
          <LinearGradient colors={gradients.brand} start={{x:0, y:0}} end={{x:1, y:0}} style={s.floatingGradient}>
            <View style={s.floatingInfo}>
              <Text style={s.floatingCount}>{selectedIds.size} SELECTED</Text>
              <TouchableOpacity onPress={exitSelectMode}><Text style={s.floatingCancel}>CANCEL</Text></TouchableOpacity>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.fActions}>
              {currentStatus === 'pending' && perms.perm_idcard_verify && <FBtn icon="check" label="VERIFY" onPress={() => handleBulkStatus('verified')} />}
              {currentStatus === 'verified' && perms.perm_idcard_approve && <FBtn icon="check-double" label="APPROVE" onPress={() => handleBulkStatus('approved')} />}
              {perms.perm_idcard_delete && <FBtn icon="trash" label="DELETE" color="#ef4444" onPress={() => handleBulkStatus('pool')} />}
            </ScrollView>
          </LinearGradient>
        </View>
      )}

      <FilterDrawer visible={showFilterDrawer} onClose={() => setShowFilterDrawer(false)} tableId={tableId} status={currentStatus} currentFilters={activeFilters} onApply={(f) => { setActiveFilters(f); setPage(1); }} />
      <CardModalForm visible={showForm} onClose={() => setShowForm(false)} tableId={tableId} cardId={editingCardId} onSuccess={onRefresh} />
      <ConfirmModal visible={confirmModal.visible} onClose={() => setConfirmModal(p => ({ ...p, visible: false }))} onConfirm={confirmModal.onConfirm} title={confirmModal.title} message={confirmModal.message} icon={confirmModal.icon} confirmColor={confirmModal.color} statusFrom={confirmModal.statusFrom} statusTo={confirmModal.statusTo} />
      <Toast visible={toast.visible} message={toast.message} type={toast.type} onHide={() => setToast(p => ({...p, visible: false}))} />
    </View>
  );
}

function FBtn({ icon, label, onPress, color='#fff' }) {
  return (
    <TouchableOpacity style={s.fBtn} onPress={onPress}>
      <DynamicIcon name={icon} size={12} color={color} style={{ marginRight: 8 }} />
      <Text style={[s.fBtnText, { color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceBg },
  tabContainer: { backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  tabScroll: { paddingHorizontal: 12, paddingVertical: 8 },
  tabItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.xs, borderWidth: 1, borderColor: '#f1f5f9', backgroundColor: '#f8fafc', marginRight: 8 },
  tabLabel: { fontSize: 9, fontFamily: 'SairaSemiCondensed-Bold', marginRight: 6 },
  tabCount: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 10 },
  tabCountText: { fontSize: 8, fontFamily: 'SairaSemiCondensed-Bold' },
  headerActions: { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 8 },
  searchWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', height: 44, borderRadius: radius.sm, paddingHorizontal: 12, borderWidth: 1, borderColor: '#e2e8f0', ...shadows.sm, marginRight: 10 },
  searchInput: { flex: 1, marginLeft: 8, fontSize: 13, fontFamily: 'SairaSemiCondensed-Medium', color: colors.gray800 },
  filterBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', height: 44, paddingHorizontal: 12, borderRadius: radius.sm, borderWidth: 1, borderColor: '#e2e8f0', ...shadows.sm },
  filterBtnText: { fontSize: 9, fontFamily: 'SairaSemiCondensed-Bold', color: colors.brandPrimary, marginLeft: 4 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  selectAllBtn: { flexDirection: 'row', alignItems: 'center' },
  checkboxSmall: { width: 14, height: 14, borderRadius: 3, borderWidth: 1, borderColor: colors.gray300, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  checkboxCheckedSmall: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  selectAllText: { fontSize: 10, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray600 },
  totalText: { fontSize: 9, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray400 },
  list: { paddingHorizontal: 12, paddingVertical: 8, paddingBottom: 100 },
  empty: { padding: 80, alignItems: 'center' },
  emptyText: { fontSize: 13, color: colors.gray400, fontFamily: 'SairaSemiCondensed-Medium' },
  floatingBar: { position: 'absolute', bottom: 20, left: 12, right: 12, borderRadius: radius.sm, overflow: 'hidden', ...shadows.lg },
  floatingGradient: { padding: 12 },
  floatingInfo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  floatingCount: { color: '#fff', fontSize: 12, fontFamily: 'SairaSemiCondensed-Bold' },
  floatingCancel: { color: 'rgba(255,255,255,0.7)', fontSize: 10, fontFamily: 'SairaSemiCondensed-Bold' },
  fActions: { flexDirection: 'row', gap: 10 },
  fBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.xs, gap: 6 },
  fBtnText: { fontSize: 10, fontFamily: 'SairaSemiCondensed-Bold' },
});
