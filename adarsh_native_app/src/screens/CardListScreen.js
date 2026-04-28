import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, FlatList, TouchableOpacity, Image, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import TopBar from '../components/TopBar';
import { CardListSkeleton } from '../components/Skeleton';
import { ErrorBanner } from '../components/NetworkGuard';
import { apiGet } from '../api/client';
import { colors, shadows } from '../theme';

const ITEM_HEIGHT = 72; // approx card height for getItemLayout

const CardItem = React.memo(function CardItem({ item, onPress }) {
  const fd = item.field_data || {};
  const name = item.name || fd.NAME || fd.name || fd.Name || `Card #${item.id}`;
  const rollNo = fd['ROLL NO'] || fd['ROLL_NO'] || fd.roll_no || '';
  const photoUrl = item.photo_url || '';

  return (
    <TouchableOpacity style={s.card} activeOpacity={0.7} onPress={onPress}>
      <View style={s.photoWrap}>
        {photoUrl ? (
          <Image source={{ uri: photoUrl }} style={s.photo} />
        ) : (
          <View style={s.photoPlaceholder}><FontAwesome5 name="user" size={14} color={colors.gray400} solid /></View>
        )}
      </View>
      <View style={s.info}>
        <Text style={s.name} numberOfLines={1}>{name}</Text>
        <View style={s.metaRow}>
          {!!rollNo && <Text style={s.rollNo}>#{rollNo}</Text>}
          {!!item.sr_no && <Text style={s.srNo}>SR: {item.sr_no}</Text>}
        </View>
      </View>
      <FontAwesome5 name="chevron-right" size={10} color={colors.gray300} />
    </TouchableOpacity>
  );
});

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
  const { tableId, status } = route.params;
  const statusDisplay = useMemo(() => (status || '').charAt(0).toUpperCase() + (status || '').slice(1), [status]);
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [tableName, setTableName] = useState('');
  const [error, setError] = useState(null);

  const perPage = 50;

  const loadCards = useCallback(async (pageNum = 1, append = false) => {
    try {
      setError(null);
      const { data } = await apiGet(`/app/api/table/${tableId}/cards/?status=${status}&page=${pageNum}&per_page=${perPage}`);
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
      setError(e.message?.includes('Network') ? 'Connection failed. Pull down to retry.' : 'Failed to load cards');
    }
  }, [tableId, status]);

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

  const onCardPress = useCallback((cardId) => {
    navigation.navigate('CardDetail', { cardId });
  }, [navigation]);

  const renderItem = useCallback(({ item }) => (
    <CardItem item={item} onPress={() => onCardPress(item.id)} />
  ), [onCardPress]);

  const keyExtractor = useCallback((item) => item.id.toString(), []);

  const getItemLayout = useCallback((_, index) => ({
    length: ITEM_HEIGHT,
    offset: ITEM_HEIGHT * index,
    index,
  }), []);

  return (
    <View style={s.root}>
      <TopBar title={`${statusDisplay} Cards`} subtitle={tableName || `Table #${tableId}`} onBack={() => navigation.goBack()} />
      {error && <ErrorBanner message={error} onRetry={() => loadCards(1)} onDismiss={() => setError(null)} />}
      {loading ? (
        <CardListSkeleton />
      ) : (
        <FlatList
          data={cards}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          getItemLayout={getItemLayout}
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
          ListFooterComponent={loadingMore ? <ActivityIndicator style={{ padding: 16 }} color={colors.brandLight} /> : null}
          ListEmptyComponent={<EmptyList status={status} />}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceBg },
  list: { padding: 16, gap: 8, paddingBottom: 32 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 16, padding: 12, borderWidth: 1, borderColor: '#f1f5f9', ...shadows.sm },
  photoWrap: { width: 48, height: 56, borderRadius: 10, overflow: 'hidden', backgroundColor: 'rgba(51,183,239,0.06)', borderWidth: 1, borderColor: '#f1f5f9' },
  photo: { width: '100%', height: '100%' },
  photoPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1, minWidth: 0 },
  name: { fontSize: 13, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray800 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3 },
  rollNo: { fontSize: 10, fontFamily: 'SairaSemiCondensed-SemiBold', color: colors.gray500 },
  srNo: { fontSize: 10, fontFamily: 'SairaSemiCondensed-Regular', color: colors.gray400 },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyIcon: { width: 64, height: 64, borderRadius: 20, backgroundColor: colors.gray100, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: 13, fontFamily: 'SairaSemiCondensed-SemiBold', color: colors.gray400 },
  emptySub: { fontSize: 11, fontFamily: 'SairaSemiCondensed-Regular', color: colors.gray300, marginTop: 4 },
});
