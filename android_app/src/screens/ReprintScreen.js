import React, { useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { DynamicIcon } from '../components/Icons';
import TopBar from '../components/TopBar';
import { ListSkeleton } from '../components/Skeleton';
import { ErrorBanner } from '../components/NetworkGuard';
import { apiGet } from '../api/client';
import { colors, shadows, radius, fontFamily } from '../theme';
import useRefreshableResource from '../hooks/useRefreshableResource';

export default function ReprintScreen({ navigation, route }) {
  const { user } = useAuth();
  const clientId = route?.params?.clientId;

  const loadData = useCallback(async () => {
    try {
      if (clientId === undefined || clientId === null) {
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
    return (
      <View style={s.card}>
        <View style={s.cardTop}>
          <View style={s.clientIcon}><DynamicIcon name="building" size={14} color="#3b82f6" /></View>
          <View style={s.info}>
            <Text style={s.clientName} numberOfLines={1}>
              {item.client_name || 'Client'}
            </Text>
            <Text style={s.tableName} numberOfLines={1}>
              {item.name} • {item.group_name}
            </Text>
          </View>
        </View>
        
        <View style={s.clientStatsRow}>
          <ClientMiniStat 
            label="REQUEST LIST" 
            count={item.requested} 
            color="#f59e0b" 
            bg="#fef3c7" 
            onPress={item.requested > 0 ? () => navigation.navigate('ReprintDetail', { tableId: item.id }) : undefined} 
          />
          <ClientMiniStat 
            label="CONFIRMED" 
            count={item.confirmed} 
            color="#10b981" 
            bg="#ecfdf5" 
            onPress={item.confirmed > 0 ? () => navigation.navigate('ReprintDetail', { tableId: item.id }) : undefined} 
          />
        </View>
      </View>
    );
  };

  const filteredTables = tables.filter(t => t.requested > 0 || t.confirmed > 0);

  return (
    <View style={s.root}>
      <TopBar title="Reprint Manager" subtitle="Request & confirmed reprints" onBack={() => navigation.goBack()} />

      {/* Summary */}
      <View style={s.summaryRow}>
        <SummaryBox icon="list" color="#f59e0b" bg="#fef3c7" label="Requested" value={totals.request} />
        <SummaryBox icon="check" color="#22c55e" bg="#d1fae5" label="Confirmed" value={totals.confirmed} />
        <SummaryBox icon="download" color="#8b5cf6" bg="#ede9fe" label="Download" value={totals.download} />
      </View>

      {error && <ErrorBanner message={error} onDismiss={() => {}} onRetry={refresh} />}
      {loading ? (
        <ListSkeleton rows={4} />
      ) : (
        <FlatList
          data={filteredTables}
          renderItem={renderItem}
          keyExtractor={item => item.id.toString()}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.brandLight} />}
          ListEmptyComponent={
            <View style={s.empty}>
              <View style={s.emptyIcon}><DynamicIcon name="redo" size={24} color={colors.gray300} /></View>
              <Text style={s.emptyTitle}>No reprints</Text>
              <Text style={s.emptySub}>All reprint requests have been processed</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

function SummaryBox({ icon, color, bg, label, value }) {
  return (
    <View style={[s.summaryBox, { borderColor: bg }]}>
      <View style={[s.summaryIcon, { backgroundColor: bg }]}><DynamicIcon name={icon} size={12} color={color} /></View>
      <Text style={[s.summaryValue, { color }]}>{value}</Text>
      <Text style={s.summaryLabel}>{label}</Text>
    </View>
  );
}

function ClientMiniStat({ label, count, color, bg, onPress }) {
  return (
    <TouchableOpacity 
      style={s.clientMiniStat} 
      onPress={onPress} 
      activeOpacity={onPress ? 0.6 : 1}
      disabled={!onPress || count === 0}
    >
      <Text style={[s.clientMiniStatLabel, { color, opacity: count > 0 ? 1 : 0.4 }]}>{label}</Text>
      <View style={[s.clientMiniStatBadge, { backgroundColor: bg, opacity: count > 0 ? 1 : 0.3 }]}>
        <Text style={[s.clientMiniStatCount, { color }]}>{count || 0}</Text>
      </View>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceBg },
  loadWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  summaryRow: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  summaryBox: { flex: 1, backgroundColor: '#fff', borderRadius: radius.sm, padding: 12, alignItems: 'center', borderWidth: 1, ...shadows.sm },
  summaryIcon: { width: 32, height: 32, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  summaryValue: { fontSize: 18, fontFamily: 'SairaSemiCondensed-Bold' },
  summaryLabel: { fontSize: 9, fontFamily: 'SairaSemiCondensed-SemiBold', color: colors.gray400, marginTop: 1 },
  list: { padding: 16, paddingBottom: 32 },
  card: { backgroundColor: '#fff', borderRadius: radius.sm, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#f1f5f9', ...shadows.sm },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  clientIcon: { width: 32, height: 32, borderRadius: 8, backgroundColor: '#eff6ff', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  info: { flex: 1, minWidth: 0 },
  clientName: { fontSize: 13, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray800 },
  tableName: { fontSize: 10, color: colors.gray400, marginTop: 2, fontFamily: 'SairaSemiCondensed-Medium' },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyIcon: { width: 64, height: 64, borderRadius: radius.xxl, backgroundColor: colors.gray100, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: 13, fontFamily: 'SairaSemiCondensed-SemiBold', color: colors.gray400 },
  
  // Stacking Client mini badges
  clientStatsRow: { flexDirection: 'row', gap: 10, marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  clientMiniStat: { alignItems: 'center', flex: 1 },
  clientMiniStatLabel: { fontSize: 7, fontFamily: 'SairaSemiCondensed-Bold', marginBottom: 4, letterSpacing: 0.3 },
  clientMiniStatBadge: { width: '100%', paddingHorizontal: 2, paddingVertical: 6, borderRadius: radius.xs, alignItems: 'center', justifyContent: 'center' },
  clientMiniStatCount: { fontSize: 10, fontFamily: 'SairaSemiCondensed-Bold' },
});
