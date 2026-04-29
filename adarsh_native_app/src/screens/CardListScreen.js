import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, FlatList, TouchableOpacity, Image, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import CardItem from '../components/CardItem';
import TopBar from '../components/TopBar';
import { CardListSkeleton } from '../components/Skeleton';
import { ErrorBanner } from '../components/NetworkGuard';
import { apiGet } from '../api/client';
import { colors, shadows, radius, spacing, typography } from '../theme';

const ITEM_HEIGHT = 86; // approx card height for getItemLayout

// Standalone CardItem is now in components/CardItem.js

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
      <TopBar 
        title={`${statusDisplay} Cards`} 
        subtitle={tableName || `Table #${tableId}`} 
        onBack={() => navigation.goBack()} 
        rightAction={{ icon: 'plus', onPress: () => navigation.navigate('CardForm', { tableId, status }) }}
      />
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
  list: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 40 },
  empty: { padding: 48, alignItems: 'center', justifyContent: 'center' },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', marginBottom: 16, ...shadows.sm },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.gray800, marginBottom: 4 },
  emptySub: { fontSize: 13, color: colors.gray400, textAlign: 'center' },
});
