import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, Image, StyleSheet, ActivityIndicator, RefreshControl, Alert } from 'react-native';
import { DynamicIcon } from '../components/Icons';
import { LinearGradient } from 'expo-linear-gradient';
import TopBar from '../components/TopBar';
import Toast from '../components/Toast';
import StatusBadge from '../components/StatusBadge';
import { CardListSkeleton } from '../components/Skeleton';
import { ErrorBanner } from '../components/NetworkGuard';
import { apiGet, apiPost } from '../api/client';
import { colors, gradients, shadows, radius, roleThemes } from '../theme';
import { useAuth } from '../context/AuthContext';

export default function ReprintDetailScreen({ navigation, route }) {
  const tableId = route?.params?.tableId;
  const { user } = useAuth();
  const theme = roleThemes[user?.role] || roleThemes.default;

  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [tableName, setTableName] = useState('');
  const [updating, setUpdating] = useState(null); // card id being updated
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });

  const perPage = 50;
  const showToast = (msg, type = 'info') => setToast({ visible: true, message: msg, type });

  const loadCards = useCallback(async (pageNum = 1, append = false) => {
    try {
      setError(null);
      const { data } = await apiGet(`/api/mobile/table/${tableId}/cards/?status=reprint&page=${pageNum}&per_page=${perPage}`);
      if (data?.success) {
        const items = data.data?.cards || data.data?.items || data.data || [];
        const list = Array.isArray(items) ? items : [];
        if (append) setCards(prev => [...prev, ...list]);
        else setCards(list);
        setHasMore(list.length >= perPage);
        if (data.data?.table?.name) setTableName(data.data.table.name);
        else if (data.data?.table_name) setTableName(data.data.table_name);
      }
    } catch (e) {
      setError(e.message?.includes('Network') ? 'Connection failed. Pull down to retry.' : 'Failed to load reprint cards');
    }
  }, [tableId]);

  useEffect(() => { (async () => { await loadCards(1); setLoading(false); })(); }, [loadCards]);

  const onRefresh = useCallback(async () => { setRefreshing(true); setPage(1); await loadCards(1); setRefreshing(false); }, [loadCards]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    const next = page + 1;
    setPage(next);
    await loadCards(next, true);
    setLoadingMore(false);
  }, [hasMore, loadingMore, page, loadCards]);

  const changeCardStatus = async (cardId, newStatus, label) => {
    Alert.alert(
      `${label} Card?`,
      `Change this card's status to ${label}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: label, onPress: async () => {
          setUpdating(cardId);
          try {
            const { data } = await apiPost(`/api/mobile/card/${cardId}/status/`, { status: newStatus });
            if (data?.success) {
              showToast(data.message || `Card ${label.toLowerCase()}!`, 'success');
              // Remove from list since status changed
              setCards(prev => prev.filter(c => c.id !== cardId));
            } else {
              showToast(data?.message || 'Failed', 'error');
            }
          } catch (e) { showToast('Network error', 'error'); }
          setUpdating(null);
        }},
      ]
    );
  };

  const renderItem = useCallback(({ item }) => {
    const fd = item.field_data || {};
    const name = item.name || fd.NAME || fd.Name || fd.name || fd.FULL_NAME || `Card #${item.id}`;
    const photoUrl = item.photo_url || '';
    const isUpdating = updating === item.id;

    return (
      <View style={s.card}>
        <TouchableOpacity style={s.cardTop} activeOpacity={0.7} onPress={() => navigation.navigate('CardDetail', { cardId: item.id })}>
          <View style={s.photoWrap}>
            {photoUrl ? (
              <Image source={{ uri: photoUrl }} style={s.photo} />
            ) : (
              <View style={s.photoPlaceholder}><DynamicIcon name="user" size={14} color={colors.gray300} /></View>
            )}
          </View>
          <View style={s.cardInfo}>
            <Text style={s.cardName} numberOfLines={1}>{name}</Text>
            <View style={s.metaRow}>
              {!!item.sr_no && <Text style={s.srBadge}>SR: {item.sr_no}</Text>}
              <StatusBadge status="reprint" size="sm" />
            </View>
          </View>
          <DynamicIcon name="chevron-right" size={10} color={colors.gray300} />
        </TouchableOpacity>

        <View style={s.cardActions}>
          {isUpdating ? (
            <ActivityIndicator size="small" color={theme.primary} />
          ) : (
            <>
              <TouchableOpacity
                style={[s.actionBtn, { backgroundColor: '#d1fae5' }]}
                onPress={() => changeCardStatus(item.id, 'verified', 'Verify')}
                activeOpacity={0.7}
              >
                <DynamicIcon name="check" size={10} color="#047857" />
                <Text style={[s.actionText, { color: '#047857' }]}>Verify</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.actionBtn, { backgroundColor: '#dbeafe' }]}
                onPress={() => changeCardStatus(item.id, 'approved', 'Approve')}
                activeOpacity={0.7}
              >
                <DynamicIcon name="thumbs-up" size={10} color="#2563eb" />
                <Text style={[s.actionText, { color: '#2563eb' }]}>Approve</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.actionBtn, { backgroundColor: '#fef3c7' }]}
                onPress={() => changeCardStatus(item.id, 'pending', 'Reset')}
                activeOpacity={0.7}
              >
                <DynamicIcon name="undo" size={10} color="#b45309" />
                <Text style={[s.actionText, { color: '#b45309' }]}>Reset</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    );
  }, [updating, navigation, theme]);

  return (
    <View style={s.root}>
      <TopBar title="Reprint Detail" subtitle={tableName || `Table #${tableId}`} onBack={() => navigation.goBack()} />
      {error && <ErrorBanner message={error} onRetry={() => loadCards(1)} onDismiss={() => setError(null)} />}
      {loading ? (
        <CardListSkeleton />
      ) : (
        <FlatList
          data={cards}
          renderItem={renderItem}
          keyExtractor={item => item.id.toString()}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandLight} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={loadingMore ? <ActivityIndicator style={{ padding: 16 }} color={colors.brandLight} /> : null}
          ListEmptyComponent={
            <View style={s.empty}>
              <View style={s.emptyIcon}><DynamicIcon name="redo" size={24} color={colors.gray300} /></View>
              <Text style={s.emptyTitle}>No reprint cards</Text>
              <Text style={s.emptySub}>All reprint requests have been processed</Text>
            </View>
          }
        />
      )}
      <Toast visible={toast.visible} message={toast.message} type={toast.type} onHide={() => setToast(p => ({...p, visible: false}))} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceBg },
  list: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 40 },
  card: { backgroundColor: '#fff', borderRadius: radius.lg, marginBottom: 10, borderWidth: 1, borderColor: '#f1f5f9', overflow: 'hidden', ...shadows.sm },
  cardTop: { flexDirection: 'row', alignItems: 'center', padding: 12 },
  photoWrap: { width: 48, height: 58, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.gray50, borderWidth: 1, borderColor: colors.gray100 },
  photo: { width: '100%', height: '100%', resizeMode: 'cover' },
  photoPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  cardInfo: { flex: 1 },
  cardName: { fontSize: 13, fontWeight: '700', color: colors.gray800, marginBottom: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center' },
  srBadge: { fontSize: 9, fontWeight: '700', color: colors.brandPrimary, backgroundColor: colors.indigo50, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.xs },
  cardActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, paddingBottom: 12 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.md },
  actionText: { fontSize: 11, fontWeight: '700' },
  empty: { padding: 48, alignItems: 'center', justifyContent: 'center' },
  emptyIcon: { width: 64, height: 64, borderRadius: radius.xxl, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', marginBottom: 16, ...shadows.sm },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.gray800, marginBottom: 4 },
  emptySub: { fontSize: 13, color: colors.gray400, textAlign: 'center' },
});
