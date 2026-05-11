import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { DynamicIcon } from '../components/Icons';
import TopBar from '../components/TopBar';
import { ListSkeleton } from '../components/Skeleton';
import { ErrorBanner } from '../components/NetworkGuard';
import { apiGet } from '../api/client';
import { colors, shadows, radius, roleThemes } from '../theme';
import { useAuth } from '../context/AuthContext';
import useRefreshableResource from '../hooks/useRefreshableResource';

export default function ClientGroupsScreen({ navigation, route }) {
  const clientId = route?.params?.clientId;
  const clientName = route?.params?.clientName || 'Client';
  const [expandedGroupId, setExpandedGroupId] = useState(null);
  const { user } = useAuth();
  const theme = roleThemes[user?.role] || roleThemes.default;

  const loadData = useCallback(async () => {
    try {
      const { ok, data } = await apiGet(`/api/mobile/client/${clientId}/tables/`);
      if (ok && data?.success) {
        return data.data || [];
      } else {
        throw new Error(data?.message || 'Failed to load client tables');
      }
    } catch (e) {
      throw new Error('Network error - check your connection');
    }
  }, [clientId]);

  const { data: tables = [], loading, refreshing, error, refresh } = useRefreshableResource(loadData, { initialData: [] });

  // Group tables by group_name
  const groupedData = React.useMemo(() => {
    const groups = {};
    (tables || []).forEach(t => {
      const gName = t.group_name || 'Ungrouped';
      if (!groups[gName]) groups[gName] = { name: gName, tables: [], totalCards: 0, pending: 0, verified: 0, pool: 0 };
      groups[gName].tables.push(t);
      groups[gName].totalCards += (t.total_cards || 0);
      groups[gName].pending += (t.pending_count || 0);
      groups[gName].verified += (t.verified_count || 0);
      groups[gName].pool += (t.pool_count || 0);
    });
    return Object.values(groups);
  }, [tables]);

  const toggleGroup = (name) => setExpandedGroupId(prev => prev === name ? null : name);

  const renderGroup = ({ item: group }) => {
    const isExpanded = expandedGroupId === group.name;
    return (
      <View style={s.groupCard}>
        <TouchableOpacity style={s.groupHeader} onPress={() => toggleGroup(group.name)} activeOpacity={0.7}>
          <View style={[s.groupIcon, { backgroundColor: theme.bgSoft }]}>
            <DynamicIcon name="layer-group" size={14} color={theme.primary} />
          </View>
          <View style={s.groupInfo}>
            <Text style={s.groupName} numberOfLines={1}>{group.name}</Text>
            <Text style={s.groupMeta}>{group.tables.length} tables · {group.totalCards} cards</Text>
          </View>
          <View style={s.groupBadges}>
            {group.pending > 0 && <MiniCount count={group.pending} bg={colors.pending.bg} c={colors.pending.text} />}
            {group.verified > 0 && <MiniCount count={group.verified} bg={colors.verified.bg} c={colors.verified.text} />}
            {group.pool > 0 && <MiniCount count={group.pool} bg={colors.pool.bg} c={colors.pool.text} />}
          </View>
          <DynamicIcon name={isExpanded ? 'chevron-up' : 'chevron-down'} size={10} color={colors.gray400} />
        </TouchableOpacity>

        {isExpanded && group.tables.length > 0 && (
          <View style={s.tablesList}>
            {group.tables.map(table => (
              <TouchableOpacity
                key={table.id}
                style={s.tableRow}
                onPress={() => navigation.navigate('CardList', { tableId: table.id, status: 'pending' })}
                activeOpacity={0.7}
              >
                <View style={s.tableIcon}><DynamicIcon name="table" size={10} color={colors.brandLight} /></View>
                <View style={s.tableInfo}>
                  <Text style={s.tableName} numberOfLines={1}>{table.name}</Text>
                  <Text style={s.tableMeta}>{table.total_cards || 0} cards</Text>
                </View>
                <View style={s.tableBadges}>
                  {table.pending_count > 0 && <MiniCount count={table.pending_count} bg={colors.pending.bg} c={colors.pending.text} />}
                  {table.verified_count > 0 && <MiniCount count={table.verified_count} bg={colors.verified.bg} c={colors.verified.text} />}
                  {table.approved_count > 0 && <MiniCount count={table.approved_count} bg={colors.approved.bg} c={colors.approved.text} />}
                  {table.download_count > 0 && <MiniCount count={table.download_count} bg={colors.download.bg} c={colors.download.text} />}
                  {table.pool_count > 0 && <MiniCount count={table.pool_count} bg={colors.pool.bg} c={colors.pool.text} />}
                </View>
                <DynamicIcon name="chevron-right" size={8} color={colors.gray300} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        {isExpanded && group.tables.length === 0 && (
          <View style={s.emptyTables}><Text style={s.emptyTablesText}>No tables in this group</Text></View>
        )}
      </View>
    );
  };

  return (
    <View style={s.root}>
      <TopBar title={clientName} subtitle="Groups & Tables" onBack={() => navigation.goBack()} />
      {error && <ErrorBanner message={error} onDismiss={() => {}} onRetry={refresh} />}
      {loading ? (
        <ListSkeleton rows={5} />
      ) : (
        <FlatList
          data={groupedData}
          renderItem={renderGroup}
          keyExtractor={item => item.name}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.brandLight} />}
          ListEmptyComponent={
            <View style={s.empty}>
              <View style={s.emptyIcon}><DynamicIcon name="layer-group" size={24} color={colors.gray300} /></View>
              <Text style={s.emptyTitle}>No groups found</Text>
              <Text style={s.emptySub}>This client has no tables yet</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

function MiniCount({ count, bg, c }) {
  return (<View style={[s.miniCount, { backgroundColor: bg }]}><Text style={[s.miniCountText, { color: c }]}>{count}</Text></View>);
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceBg },
  list: { padding: 16, paddingBottom: 40 },
  groupCard: { backgroundColor: colors.white, borderRadius: radius.lg, marginBottom: 12, borderWidth: 1, borderColor: '#f1f5f9', overflow: 'hidden', ...shadows.sm },
  groupHeader: { flexDirection: 'row', alignItems: 'center', padding: 16 },
  groupIcon: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  groupInfo: { flex: 1 },
  groupName: { fontSize: 15, fontWeight: '700', color: colors.gray800 },
  groupMeta: { fontSize: 11, color: colors.gray500, marginTop: 2 },
  tablesList: { paddingHorizontal: 16, paddingBottom: 16, backgroundColor: '#f9fafb', borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  tableIcon: { width: 28, height: 28, borderRadius: radius.sm, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#f1f5f9' },
  tableInfo: { flex: 1 },
  tableName: { fontSize: 13, fontWeight: '600', color: colors.gray700 },
  tableMeta: { fontSize: 10, color: colors.gray400, marginTop: 1 },
  emptyTables: { padding: 20, alignItems: 'center' },
  emptyTablesText: { fontSize: 12, color: colors.gray400 },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyIcon: { width: 64, height: 64, borderRadius: radius.xxl, backgroundColor: colors.gray100, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: 13, fontWeight: '600', color: colors.gray400 },
  emptySub: { fontSize: 11, color: colors.gray300, marginTop: 4 },
  groupBadges: { flexDirection: 'row', marginRight: 8 },
  tableBadges: { flexDirection: 'row', marginRight: 8 },
  miniCount: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.xs, minWidth: 20, alignItems: 'center' },
  miniCountText: { fontSize: 10, fontWeight: '800' },
});
