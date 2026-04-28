import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import TopBar from '../components/TopBar';
import { ListSkeleton } from '../components/Skeleton';
import { apiGet } from '../api/client';
import { colors, shadows } from '../theme';

export default function GroupsScreen({ navigation }) {
  const [groups, setGroups] = useState([]);
  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedGroupId, setExpandedGroupId] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await apiGet('/app/api/groups/');
        if (data?.success) { setGroups(data.data?.groups || []); setTables(data.data?.tables || []); }
      } catch (e) { /* silent */ }
      setLoading(false);
    })();
  }, []);

  const toggleGroup = (id) => setExpandedGroupId(prev => prev === id ? null : id);

  const renderGroup = ({ item: group }) => {
    const isExpanded = expandedGroupId === group.id;
    const groupTables = tables.filter(t => t.group_id === group.id);

    return (
      <View style={s.groupCard}>
        <TouchableOpacity style={s.groupHeader} onPress={() => toggleGroup(group.id)} activeOpacity={0.7}>
          <View style={s.groupIcon}><FontAwesome5 name="layer-group" size={14} color="#8b5cf6" solid /></View>
          <View style={s.groupInfo}>
            <Text style={s.groupName} numberOfLines={1}>{group.name}</Text>
            <Text style={s.groupMeta}>{group.table_count || 0} tables · {group.total_cards || 0} cards</Text>
          </View>
          <View style={s.groupBadges}>
            {group.pending_cards > 0 && <MiniCount count={group.pending_cards} bg="#fef3c7" c="#b45309" />}
            {group.verified_cards > 0 && <MiniCount count={group.verified_cards} bg="#d1fae5" c="#047857" />}
            {group.approved_cards > 0 && <MiniCount count={group.approved_cards} bg="#e0f2fe" c="#0369a1" />}
          </View>
          <FontAwesome5 name={isExpanded ? 'chevron-up' : 'chevron-down'} size={10} color={colors.gray400} />
        </TouchableOpacity>

        {isExpanded && groupTables.length > 0 && (
          <View style={s.tablesList}>
            {groupTables.map(table => (
              <View key={table.id} style={s.tableRow}>
                <View style={s.tableIcon}><FontAwesome5 name="table" size={10} color={colors.brandLight} /></View>
                <View style={s.tableInfo}>
                  <Text style={s.tableName} numberOfLines={1}>{table.name}</Text>
                  <Text style={s.tableMeta}>{table.total_cards || 0} cards</Text>
                </View>
                <View style={s.tableBadges}>
                  {table.pending_cards > 0 && <MiniCount count={table.pending_cards} bg="#fef3c7" c="#b45309" />}
                  {table.verified_cards > 0 && <MiniCount count={table.verified_cards} bg="#d1fae5" c="#047857" />}
                  {table.approved_cards > 0 && <MiniCount count={table.approved_cards} bg="#e0f2fe" c="#0369a1" />}
                  {table.download_cards > 0 && <MiniCount count={table.download_cards} bg="#ede9fe" c="#7c3aed" />}
                </View>
              </View>
            ))}
          </View>
        )}

        {isExpanded && groupTables.length === 0 && (
          <View style={s.emptyTables}><Text style={s.emptyTablesText}>No tables in this group</Text></View>
        )}
      </View>
    );
  };

  return (
    <View style={s.root}>
      <TopBar title="Groups & Tables" subtitle="Manage your groups" onBack={() => navigation.goBack()} />
      {loading ? (
        <ListSkeleton rows={5} />
      ) : (
        <FlatList
          data={groups}
          renderItem={renderGroup}
          keyExtractor={item => item.id.toString()}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={<View style={s.empty}><View style={s.emptyIcon}><FontAwesome5 name="layer-group" size={24} color={colors.gray300} /></View><Text style={s.emptyTitle}>No groups found</Text></View>}
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
  loadWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16, gap: 10, paddingBottom: 32 },
  groupCard: { backgroundColor: '#fff', borderRadius: 20, borderWidth: 1, borderColor: '#e2e8f0', overflow: 'hidden', ...shadows.sm },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  groupIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#ede9fe', alignItems: 'center', justifyContent: 'center' },
  groupInfo: { flex: 1, minWidth: 0 },
  groupName: { fontSize: 13, fontWeight: '700', color: colors.gray800 },
  groupMeta: { fontSize: 10, color: colors.gray400, marginTop: 2 },
  groupBadges: { flexDirection: 'row', gap: 4 },
  miniCount: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, minWidth: 24, alignItems: 'center' },
  miniCountText: { fontSize: 10, fontWeight: '800' },
  tablesList: { borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  tableRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f9fafb' },
  tableIcon: { width: 32, height: 32, borderRadius: 8, backgroundColor: 'rgba(51,183,239,0.08)', alignItems: 'center', justifyContent: 'center' },
  tableInfo: { flex: 1, minWidth: 0 },
  tableName: { fontSize: 12, fontWeight: '600', color: colors.gray700 },
  tableMeta: { fontSize: 10, color: colors.gray400, marginTop: 1 },
  tableBadges: { flexDirection: 'row', gap: 4 },
  emptyTables: { padding: 16, alignItems: 'center' },
  emptyTablesText: { fontSize: 11, color: colors.gray400 },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyIcon: { width: 64, height: 64, borderRadius: 20, backgroundColor: colors.gray100, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: 13, fontWeight: '600', color: colors.gray400 },
});
