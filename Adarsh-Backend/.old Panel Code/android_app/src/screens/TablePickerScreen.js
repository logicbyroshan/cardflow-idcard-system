import React, { useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { DynamicIcon } from '../components/Icons';
import TopBar from '../components/TopBar';
import { apiGet } from '../api/client';
import { colors, typography, spacing, radius, shadows, fontFamily } from '../theme';
import useRefreshableResource from '../hooks/useRefreshableResource';
import { TablePickerSkeleton } from '../components/Skeleton';

const STATUS_COLORS = {
  pending: { bg: '#fef3c7', text: '#b45309' },
  verified: { bg: '#d1fae5', text: '#047857' },
  approved: { bg: '#e0f2fe', text: '#0369a1' },
  download: { bg: '#ede9fe', text: '#7c3aed' },
  pool: { bg: '#fce7f3', text: '#be185d' },
};

export default function TablePickerScreen({ navigation, route }) {
  const status = route?.params?.status || 'pending';
  const statusDisplay = status.charAt(0).toUpperCase() + status.slice(1);

  const loadTables = useCallback(async () => {
    const { data } = await apiGet(`/api/mobile/tables/?status=${encodeURIComponent(status)}`);
    if (data?.success) {
      return data.data || [];
    }
    throw new Error('Failed to load tables');
  }, [status]);

  const { data: tables = [], loading } = useRefreshableResource(loadTables, { initialData: [] });

  const sc = STATUS_COLORS[status] || STATUS_COLORS.pending;

  const renderItem = ({ item }) => (
    <TouchableOpacity
      style={s.card}
      activeOpacity={0.7}
      onPress={() => {
        navigation.navigate('CardList', { tableId: item.id, status });
      }}
    >
      <View style={s.iconWrap}>
        <DynamicIcon name="table" size={15} color={colors.brandLight} />
      </View>
      <View style={s.info}>
        <Text style={s.tableName} numberOfLines={1}>{item.name}</Text>
        <Text style={s.groupName} numberOfLines={1}>
          {item.client_name ? `${item.client_name} — ` : ''}{item.group_name || ''}
        </Text>
      </View>
      <View style={s.countBadgeRow}>
        <View style={[s.countBadge, { backgroundColor: sc.bg }]}>
          <Text style={[s.countText, { color: sc.text }]}>{item.status_count ?? 0}</Text>
        </View>
        <DynamicIcon name="chevron-right" size={10} color={colors.gray300} />
      </View>
    </TouchableOpacity>
  );

  const EmptyState = () => (
    <View style={s.empty}>
      <View style={s.emptyIcon}><DynamicIcon name="table" size={24} color={colors.gray300} /></View>
      <Text style={s.emptyTitle}>No tables available</Text>
      <Text style={s.emptySub}>No tables with {status} cards</Text>
    </View>
  );

  return (
    <View style={s.root}>
      <TopBar title={`${statusDisplay} List`} subtitle="Select a table to view cards" onBack={() => navigation.goBack()} />
      {loading ? (
        <TablePickerSkeleton />
      ) : (
        <FlatList
          data={tables}
          renderItem={renderItem}
          keyExtractor={(item, i) => item.id?.toString() || i.toString()}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={EmptyState}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceBg },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16, paddingBottom: 32 },
  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: radius.md, padding: 14,
    borderWidth: 1, borderColor: '#f1f5f9', ...shadows.sm,
  },
  iconWrap: {
    width: 44, height: 44, borderRadius: radius.sm,
    backgroundColor: 'rgba(51,183,239,0.08)',
    alignItems: 'center', justifyContent: 'center',
  },
  info: { flex: 1, minWidth: 0 },
  tableName: { fontSize: 13, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray800 },
  groupName: { fontSize: 10, color: colors.gray400, marginTop: 2, fontFamily: 'SairaSemiCondensed-Medium' },
  countBadgeRow: { flexDirection: 'row', alignItems: 'center' },
  countBadge: { minWidth: 42, height: 28, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  countText: { fontSize: 11, fontFamily: 'SairaSemiCondensed-Bold' },
  empty: { alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyIcon: { width: 64, height: 64, borderRadius: radius.xxl, backgroundColor: colors.gray100, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: 13, fontFamily: 'SairaSemiCondensed-SemiBold', color: colors.gray400 },
  emptySub: { fontSize: 11, color: colors.gray300, marginTop: 4, fontFamily: 'SairaSemiCondensed-Medium' },
});
