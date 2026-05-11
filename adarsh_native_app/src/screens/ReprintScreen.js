import React, { useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import TopBar from '../components/TopBar';
import { ListSkeleton } from '../components/Skeleton';
import { ErrorBanner } from '../components/NetworkGuard';
import { apiGet } from '../api/client';
import { colors, shadows, radius, fontFamily } from '../theme';
import useRefreshableResource from '../hooks/useRefreshableResource';

export default function ReprintScreen({ navigation, route }) {
  const { user } = useAuth();
  const clientId = route?.params?.clientId || user?.client_id;
  const [activeTab, setActiveTab] = useState('request_list');

  const loadData = useCallback(async () => {
    try {
      if (!clientId) {
        return { tables: [], totals: { request: 0, confirmed: 0, download: 0 } };
      }
      const { ok, data } = await apiGet(`/api/mobile/reprint/${clientId}/`);
      if (ok && data?.success) {
        return {
          tables: data.data?.tables || [],
          totals: {
          request: data.data?.request_total || 0,
          confirmed: data.data?.confirmed_total || 0,
          download: data.data?.download_total || 0,
          },
        };
      } else {
        throw new Error(data?.message || 'Failed to load reprint data');
      }
    } catch (e) {
      throw new Error('Network error - check your connection');
    }
  }, [clientId]);

  const { data, loading, refreshing, error, refresh } = useRefreshableResource(loadData, {
    initialData: { tables: [], totals: { request: 0, confirmed: 0, download: 0 } },
  });

  const tables = data.tables || [];
  const totals = data.totals || { request: 0, confirmed: 0, download: 0 };

  const renderItem = ({ item }) => {
    const count = activeTab === 'request_list' ? item.requested : item.confirmed;
    return (
      <TouchableOpacity 
        style={s.card} 
        activeOpacity={0.7} 
        onPress={() => navigation.navigate('ReprintDetail', { tableId: item.id })}
      >
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
        <FontAwesome5 name="chevron-right" size={10} color={colors.gray300} style={{ marginLeft: 8 }} />
      </TouchableOpacity>
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

      {error && <ErrorBanner message={error} onDismiss={() => {}} onRetry={refresh} />}
      {loading ? (
        <ListSkeleton rows={4} />
      ) : (
        <FlatList
          data={tables.filter(t => activeTab === 'request_list' ? t.requested > 0 : t.confirmed > 0)}
          renderItem={renderItem}
          keyExtractor={item => item.id.toString()}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.brandLight} />}
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
  summaryRow: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 12 },
  summaryBox: { flex: 1, backgroundColor: '#fff', borderRadius: radius.lg, padding: 12, alignItems: 'center', borderWidth: 1, ...shadows.sm },
  summaryIcon: { width: 32, height: 32, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  summaryValue: { fontSize: 18, fontFamily: fontFamily.bold },
  summaryLabel: { fontSize: 9, fontFamily: fontFamily.semibold, color: colors.gray400, marginTop: 1 },
  tabs: { flexDirection: 'row', marginHorizontal: 16, marginTop: 12, backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: '#e2e8f0', overflow: 'hidden' },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { backgroundColor: 'rgba(51,183,239,0.08)' },
  tabText: { fontSize: 12, fontFamily: fontFamily.semibold, color: colors.gray400 },
  tabTextActive: { color: colors.brandLight, fontFamily: fontFamily.bold },
  list: { padding: 16, paddingBottom: 32 },
  card: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff', borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: '#f1f5f9', ...shadows.sm },
  cardLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  tableIcon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: '#fef3c7', alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1, minWidth: 0 },
  tableName: { fontSize: 13, fontFamily: fontFamily.bold, color: colors.gray800 },
  groupName: { fontSize: 10, color: colors.gray400, marginTop: 2, fontFamily: fontFamily.medium },
  countBadge: { backgroundColor: '#fef3c7', paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.xs, minWidth: 36, alignItems: 'center' },
  countText: { fontSize: 12, fontFamily: fontFamily.bold, color: '#b45309' },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyIcon: { width: 64, height: 64, borderRadius: radius.xxl, backgroundColor: colors.gray100, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: 13, fontFamily: fontFamily.semibold, color: colors.gray400 },
});
