import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import TopBar from '../components/TopBar';
import { ListSkeleton } from '../components/Skeleton';
import { apiGet } from '../api/client';
import { colors, shadows } from '../theme';

export default function ReprintScreen({ navigation, route }) {
  const clientId = route?.params?.clientId;
  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('request_list');
  const [totals, setTotals] = useState({ request: 0, confirmed: 0, download: 0 });

  useEffect(() => {
    (async () => {
      try {
        if (!clientId) { setLoading(false); return; }
        const { data } = await apiGet(`/app/api/reprint/${clientId}/`);
        if (data?.success) {
          setTables(data.data?.tables || []);
          setTotals({
            request: data.data?.request_total || 0,
            confirmed: data.data?.confirmed_total || 0,
            download: data.data?.download_total || 0,
          });
        }
      } catch (e) { /* silent */ }
      setLoading(false);
    })();
  }, [clientId]);

  const renderItem = ({ item }) => {
    const count = activeTab === 'request_list' ? item.requested : item.confirmed;
    return (
      <View style={s.card}>
        <View style={s.cardLeft}>
          <View style={s.tableIcon}><FontAwesome5 name="redo" size={12} color="#f59e0b" /></View>
          <View style={s.info}>
            <Text style={s.tableName} numberOfLines={1}>{item.name}</Text>
            <Text style={s.groupName}>{item.group_name}</Text>
          </View>
        </View>
        <View style={s.countBadge}>
          <Text style={s.countText}>{count}</Text>
        </View>
      </View>
    );
  };

  return (
    <View style={s.root}>
      <TopBar title="Reprint Manager" subtitle="Request & confirmed reprints" onBack={() => navigation.goBack()} />

      {/* Summary */}
      <View style={s.summaryRow}>
        <SummaryBox icon="list" color="#f59e0b" bg="#fef3c7" label="Requested" value={totals.request} />
        <SummaryBox icon="check" color="#22c55e" bg="#d1fae5" label="Confirmed" value={totals.confirmed} />
        <SummaryBox icon="download" color="#8b5cf6" bg="#ede9fe" label="Download" value={totals.download} />
      </View>

      {/* Tabs */}
      <View style={s.tabs}>
        <TouchableOpacity style={[s.tab, activeTab === 'request_list' && s.tabActive]} onPress={() => setActiveTab('request_list')} activeOpacity={0.7}>
          <Text style={[s.tabText, activeTab === 'request_list' && s.tabTextActive]}>Request List ({totals.request})</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.tab, activeTab === 'confirmed' && s.tabActive]} onPress={() => setActiveTab('confirmed')} activeOpacity={0.7}>
          <Text style={[s.tabText, activeTab === 'confirmed' && s.tabTextActive]}>Confirmed ({totals.confirmed})</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ListSkeleton rows={4} />
      ) : (
        <FlatList
          data={tables.filter(t => activeTab === 'request_list' ? t.requested > 0 : t.confirmed > 0)}
          renderItem={renderItem}
          keyExtractor={item => item.id.toString()}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={<View style={s.empty}><View style={s.emptyIcon}><FontAwesome5 name="redo" size={24} color={colors.gray300} /></View><Text style={s.emptyTitle}>No {activeTab === 'request_list' ? 'requested' : 'confirmed'} reprints</Text></View>}
        />
      )}
    </View>
  );
}

function SummaryBox({ icon, color, bg, label, value }) {
  return (
    <View style={[s.summaryBox, { borderColor: bg }]}>
      <View style={[s.summaryIcon, { backgroundColor: bg }]}><FontAwesome5 name={icon} size={12} color={color} solid /></View>
      <Text style={[s.summaryValue, { color }]}>{value}</Text>
      <Text style={s.summaryLabel}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceBg },
  loadWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  summaryRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 12 },
  summaryBox: { flex: 1, backgroundColor: '#fff', borderRadius: 16, padding: 10, alignItems: 'center', borderWidth: 1.5, ...shadows.sm },
  summaryIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  summaryValue: { fontSize: 18, fontWeight: '800' },
  summaryLabel: { fontSize: 9, fontWeight: '600', color: colors.gray400, marginTop: 1 },
  tabs: { flexDirection: 'row', marginHorizontal: 16, marginTop: 12, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', overflow: 'hidden' },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { backgroundColor: 'rgba(51,183,239,0.08)' },
  tabText: { fontSize: 12, fontWeight: '600', color: colors.gray400 },
  tabTextActive: { color: colors.brandLight, fontWeight: '700' },
  list: { padding: 16, gap: 8, paddingBottom: 32 },
  card: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: '#f1f5f9', ...shadows.sm },
  cardLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  tableIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#fef3c7', alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1, minWidth: 0 },
  tableName: { fontSize: 13, fontWeight: '700', color: colors.gray800 },
  groupName: { fontSize: 10, color: colors.gray400, marginTop: 2 },
  countBadge: { backgroundColor: '#fef3c7', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, minWidth: 36, alignItems: 'center' },
  countText: { fontSize: 12, fontWeight: '800', color: '#b45309' },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyIcon: { width: 64, height: 64, borderRadius: 20, backgroundColor: colors.gray100, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: 13, fontWeight: '600', color: colors.gray400 },
});
