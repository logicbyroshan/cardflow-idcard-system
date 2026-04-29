import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, FlatList, TouchableOpacity, Image, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import CardItem from '../components/CardItem';
import TopBar from '../components/TopBar';
import { useToast } from '../context/ToastContext';
import { CardListSkeleton } from '../components/Skeleton';
import { ErrorView, ERROR_TYPES } from '../components/NetworkGuard';
import { apiGet } from '../api/client';
import { colors, shadows, radius, spacing, typography } from '../theme';

const ITEM_HEIGHT = 106; // approx card height for getItemLayout

const EmptyList = React.memo(function EmptyList({ status }) {
  return (
    <View style={s.empty}>
      <View style={s.emptyIcon}><FontAwesome5 name="id-card" size={32} color={colors.gray300} /></View>
      <Text style={s.emptyTitle}>No {status} cards</Text>
      <Text style={s.emptySub}>Cards will appear here when available</Text>
    </View>
  );
});

export default function CardListScreen({ navigation, route }) {
  const { tableId, status } = route?.params || {};
  const statusDisplay = useMemo(() => (status || '').charAt(0).toUpperCase() + (status || '').slice(1), [status]);
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [tableName, setTableName] = useState('');
  const [error, setError] = useState(null);
  const { showToast } = useToast();

  const perPage = 50;

  const loadCards = useCallback(async (pageNum = 1, append = false, isSilent = false) => {
    try {
      if (!isSilent) setError(null);
      const { data } = await apiGet(`/app/api/table/${tableId}/cards/?status=${status}&page=${pageNum}&per_page=${perPage}`);
      if (data?.success) {
        const items = data.data?.cards || data.data?.items || data.data || [];
        const list = Array.isArray(items) ? items : [];
        if (append) setCards(prev => [...prev, ...list]);
        else setCards(list);
        setHasMore(list.length >= perPage);
        if (data.data?.table?.name) setTableName(data.data.table.name);
        else if (data.data?.table_name) setTableName(data.data.table_name);
      } else {
        if (isSilent) showToast('Failed to load cards');
        else setError('Failed to load cards');
      }
    } catch (e) {
      const msg = e.message?.includes('Network') ? 'Network connection lost' : 'Failed to sync cards';
      if (isSilent) showToast(msg);
      else setError(e.message?.includes('Network') ? 'network' : 'server');
    }
  }, [tableId, status, showToast]);

  useEffect(() => { (async () => { await loadCards(1); setLoading(false); })(); }, [loadCards]);

  const onRefresh = useCallback(async () => { setRefreshing(true); setPage(1); await loadCards(1, false, true); setRefreshing(false); }, [loadCards]);

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
      <TopBar 
        title={`${statusDisplay} Cards`} 
        subtitle={tableName || `Table #${tableId}`} 
        onBack={() => navigation.goBack()} 
        rightAction={{ icon: 'plus', onPress: () => navigation.navigate('CardForm', { tableId, status }) }}
      />
      
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
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandPrimary} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          removeClippedSubviews={true}
          maxToRenderPerBatch={15}
          windowSize={11}
          initialNumToRender={12}
          updateCellsBatchingPeriod={50}
          ListFooterComponent={loadingMore ? <ActivityIndicator style={{ padding: 16 }} color={colors.brandPrimary} /> : null}
          ListEmptyComponent={<EmptyList status={status} />}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceBg },
  list: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 40 },
  empty: { padding: 60, alignItems: 'center', justifyContent: 'center' },
  emptyIcon: { width: 80, height: 80, borderRadius: 32, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', marginBottom: 20, ...shadows.md },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: colors.gray800, marginBottom: 8, fontFamily: 'SairaSemiCondensed-Bold' },
  emptySub: { fontSize: 14, color: colors.gray400, textAlign: 'center', fontFamily: 'SairaSemiCondensed-Regular', lineHeight: 20 },
});
