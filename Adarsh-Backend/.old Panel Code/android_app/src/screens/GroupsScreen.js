import React, { useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { DynamicIcon } from '../components/Icons';
import TopBar from '../components/TopBar';
import { GroupsSkeleton } from '../components/Skeleton';
import { ErrorBanner } from '../components/NetworkGuard';
import StatusBadge from '../components/StatusBadge';
import { apiGet } from '../api/client';
import { colors, shadows, radius, roleThemes, fontFamily } from '../theme';
import { useAuth } from '../context/AuthContext';
import useRefreshableResource from '../hooks/useRefreshableResource';

const STATUS_LABELS = { pending: 'Pending', verified: 'Verified', approved: 'Approved', download: 'Download', pool: 'Pool', reprint: 'Reprint' };

export default function GroupsScreen({ navigation }) {
  const { user } = useAuth();
  const theme = roleThemes[user?.role] || roleThemes.default;

  const loadData = useCallback(async () => {
    const { ok, data } = await apiGet('/api/mobile/groups/');
    if (!ok || !data?.success) {
      throw new Error(data?.message || 'Failed to load tables');
    }
    return data.data?.tables || [];
  }, []);

  const { data: tables = [], loading, refreshing, error, refresh } = useRefreshableResource(loadData, { initialData: [] });

  const renderTable = ({ item: table }) => {
    // API returns keys like pending_cards, verified_cards for groups/tables API
    const counts = {
      p: table.pending_cards || 0,
      v: table.verified_cards || 0,
      a: table.approved_cards || 0,
      d: table.download_cards || 0,
      po: table.pool_cards || 0,
      r: table.reprint_cards || 0,
    };

    return (
      <View style={s.tableCard}>
        <TouchableOpacity
          style={s.tableTop}
          activeOpacity={0.7}
          onPress={() => navigation.navigate('CardList', { tableId: table.id, status: 'all' })}
        >
          <View style={[s.tableIcon, { backgroundColor: theme.bgSoft }]}>
            <DynamicIcon name="table" size={13} color={theme.primary} />
          </View>
          <View style={s.tableNameWrap}>
            <Text style={s.tableName} numberOfLines={1}>{table.name}</Text>
            {table.group_name ? <Text style={s.groupName} numberOfLines={1}>{table.group_name}</Text> : null}
          </View>
        </TouchableOpacity>
        <View style={s.tablePills}>
          {[
            { key: 'p', status: 'pending' },
            { key: 'v', status: 'verified' },
            { key: 'a', status: 'approved' },
            { key: 'd', status: 'download' },
            { key: 'r', status: 'reprint' },
          ].map(st => (
            <TouchableOpacity key={st.key} style={s.pillBtn}
              onPress={() => navigation.navigate('CardList', { tableId: table.id, status: st.status })}>
              <Text style={s.pillLabel} numberOfLines={1}>{STATUS_LABELS[st.status]?.substring(0, 3).toUpperCase() || ''}</Text>
              <StatusBadge status={st.status} count={counts[st.key] || 0} variant="glass" />
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  };

  return (
    <View style={s.root}>
      <TopBar title="Groups & Tables" subtitle="Manage your groups" onBack={() => navigation.goBack()} />
      {error && <ErrorBanner message={error} onDismiss={() => refresh()} onRetry={() => refresh()} />}
      {loading ? (
        <GroupsSkeleton />
      ) : (
        <FlatList
          data={tables}
          renderItem={renderTable}
          keyExtractor={item => item.id.toString()}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.brandLight} />}
          ListEmptyComponent={
            <View style={s.empty}>
              <View style={s.emptyIcon}><DynamicIcon name="table" size={24} color={colors.gray300} /></View>
              <Text style={s.emptyTitle}>No tables found</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceBg },
  list: { padding: 16, paddingBottom: 40 },
  
  tableCard: { backgroundColor: '#fff', borderRadius: radius.sm, padding: 14, borderWidth: 1, borderColor: colors.gray100, ...shadows.sm, marginBottom: 10 },
  tableTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  tableIcon: { width: 34, height: 34, borderRadius: radius.xs, alignItems: 'center', justifyContent: 'center' },
  tableNameWrap: { flex: 1 },
  tableName: { fontSize: 14, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray800 },
  groupName: { fontSize: 10, fontFamily: 'SairaSemiCondensed-Medium', color: colors.gray400, marginTop: 1 },
  
  tablePills: { flexDirection: 'row', justifyContent: 'space-between' },
  pillBtn: { flex: 1, alignItems: 'center', minWidth: 0 },
  pillLabel: { fontSize: 7, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray400, marginBottom: 4, textTransform: 'uppercase' },
  
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyIcon: { width: 64, height: 64, borderRadius: radius.xxl, backgroundColor: colors.gray100, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: 13, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray400 },
});
