import React, { useState, useCallback, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl, LayoutAnimation } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { DynamicIcon } from '../components/Icons';
import TopBar from '../components/TopBar';
import { ReprintSkeleton } from '../components/Skeleton';
import { ErrorBanner } from '../components/NetworkGuard';
import { apiGet } from '../api/client';
import { colors, shadows, radius, fontFamily, roleThemes } from '../theme';
import useRefreshableResource from '../hooks/useRefreshableResource';

export default function ReprintScreen({ navigation, route }) {
  const { user } = useAuth();
  const clientId = route?.params?.clientId;
  const theme = roleThemes[user?.role] || roleThemes.default;

  const [expandedClient, setExpandedClient] = useState(null); // { id }

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

  const groupedClients = useMemo(() => {
    const clientsMap = {};
    tables.forEach(table => {
      const cid = table.client_id || 0;
      if (!clientsMap[cid]) {
        clientsMap[cid] = {
          id: cid,
          name: table.client_name || 'Global Client',
          requested: 0,
          confirmed: 0,
          tables: []
        };
      }
      clientsMap[cid].requested += table.requested || 0;
      clientsMap[cid].confirmed += table.confirmed || 0;
      clientsMap[cid].tables.push(table);
    });
    return Object.values(clientsMap).sort((a, b) => (b.requested + b.confirmed) - (a.requested + a.confirmed));
  }, [tables]);

  const handleClientPress = (client) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedClient(prev => prev?.id === client.id ? null : { id: client.id });
  };

  const handleBadgePress = (client) => {
    const allTables = client.tables || [];
    if (allTables.length === 0) return;
    
    if (allTables.length === 1) {
      navigation.navigate('ReprintDetail', { tableId: allTables[0].id });
    } else {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setExpandedClient(prev => prev?.id === client.id ? null : { id: client.id });
    }
  };

  const renderItem = ({ item: client }) => {
    const isExpanded = expandedClient?.id === client.id;
    return (
      <View style={s.cardWrapper}>
        <LinearGradient colors={['#ffffff', '#f8fafc']} start={{x:0, y:0}} end={{x:1, y:0}} style={s.clientCardGradient}>
          <View style={s.clientCard}>
            <TouchableOpacity 
              style={s.clientHeader} 
              activeOpacity={0.7}
              onPress={() => handleClientPress(client)}
            >
              <View style={[s.clientIcon, { backgroundColor: theme.bgSoft }]}><DynamicIcon name="building" size={14} color={theme.primary} /></View>
              <View style={s.clientInfo}><Text style={s.clientName} numberOfLines={1} ellipsizeMode="tail">{client.name}</Text></View>
              <DynamicIcon name={isExpanded ? "chevron-up" : "chevron-down"} size={10} color={colors.gray400} />
            </TouchableOpacity>

            <View style={s.clientStatsRow}>
              <ClientMiniStat 
                label="REQUESTED" 
                count={client.requested} 
                color="#f59e0b" 
                bg="#fef3c7" 
                onPress={() => handleBadgePress(client)} 
              />
              <ClientMiniStat 
                label="CONFIRMED" 
                count={client.confirmed} 
                color="#10b981" 
                bg="#ecfdf5" 
                onPress={() => handleBadgePress(client)} 
              />
            </View>

            {isExpanded && (
              <View style={s.expandedContent}>
                <View style={s.expandedHeader}>
                  <Text style={s.expandedTitle}>TABLES / LISTS</Text>
                  <TouchableOpacity onPress={() => setExpandedClient(null)}><DynamicIcon name="times" size={10} color={colors.gray400} /></TouchableOpacity>
                </View>
                {(client.tables || []).map(table => (
                  <View key={table.id} style={s.expandedItem}>
                    <View style={s.expandedItemHeader}>
                      <Text style={s.expandedItemName}>{table.name}</Text>
                      <Text style={s.expandedItemGroup}>{table.group_name}</Text>
                    </View>
                    <View style={s.statusButtonsRowBelow}>
                      <TouchableOpacity
                        style={[
                          s.stBtnBelow,
                          { 
                            backgroundColor: '#fef3c7',
                            borderColor: '#f59e0b60',
                          }
                        ]}
                        activeOpacity={0.7}
                        onPress={() => navigation.navigate('ReprintDetail', { tableId: table.id })}
                      >
                        <Text style={[s.stBtnTextBelow, { color: '#f59e0b' }]}>
                          Requested ({table.requested || 0})
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          s.stBtnBelow,
                          { 
                            backgroundColor: '#ecfdf5',
                            borderColor: '#10b98160',
                          }
                        ]}
                        activeOpacity={0.7}
                        onPress={() => navigation.navigate('ReprintDetail', { tableId: table.id })}
                      >
                        <Text style={[s.stBtnTextBelow, { color: '#10b981' }]}>
                          Confirmed ({table.confirmed || 0})
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        </LinearGradient>
      </View>
    );
  };

  return (
    <View style={s.root}>
      <TopBar title="Reprint Manager" subtitle="Request & confirmed reprints" onBack={() => navigation.goBack()} />

      {error && <ErrorBanner message={error} onDismiss={() => {}} onRetry={refresh} />}
      {loading ? (
        <ReprintSkeleton />
      ) : (
        <>
          {/* Summary */}
          <View style={s.summaryRow}>
            <SummaryBox icon="list" color="#f59e0b" bg="#fef3c7" label="Requested" value={totals.request} />
            <SummaryBox icon="check" color="#22c55e" bg="#d1fae5" label="Confirmed" value={totals.confirmed} />
            <SummaryBox icon="download" color="#8b5cf6" bg="#ede9fe" label="Download" value={totals.download} />
          </View>

          <FlatList
            data={groupedClients}
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
        </>
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
      activeOpacity={0.6}
    >
      <Text style={[s.clientMiniStatLabel, { color }]}>{label}</Text>
      <View style={[s.clientMiniStatBadge, { backgroundColor: bg }]}>
        <Text style={[s.clientMiniStatCount, { color }]}>{count || 0}</Text>
      </View>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceBg },
  summaryRow: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  summaryBox: { flex: 1, backgroundColor: '#fff', borderRadius: radius.sm, padding: 12, alignItems: 'center', borderWidth: 1, ...shadows.sm },
  summaryIcon: { width: 32, height: 32, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  summaryValue: { fontSize: 18, fontFamily: 'SairaSemiCondensed-Bold' },
  summaryLabel: { fontSize: 9, fontFamily: 'SairaSemiCondensed-SemiBold', color: colors.gray400, marginTop: 1 },
  list: { padding: 16, paddingBottom: 32 },
  cardWrapper: { marginBottom: 12 },
  clientCardGradient: { borderRadius: radius.sm, padding: 1.5, ...shadows.sm },
  clientCard: { backgroundColor: '#fff', borderRadius: radius.sm - 1, padding: 10 },
  clientHeader: { flexDirection: 'row', alignItems: 'center' },
  clientIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  clientInfo: { flex: 1, minWidth: 0 },
  clientName: { fontSize: 13, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray800 },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyIcon: { width: 64, height: 64, borderRadius: radius.xxl, backgroundColor: colors.gray100, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: 13, fontFamily: 'SairaSemiCondensed-SemiBold', color: colors.gray400 },
  emptySub: { color: colors.gray400, fontSize: 12, fontFamily: 'SairaSemiCondensed-Medium', marginTop: 4 },
  
  clientStatsRow: { flexDirection: 'row', gap: 10, marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  clientMiniStat: { alignItems: 'center', flex: 1 },
  clientMiniStatLabel: { fontSize: 7, fontFamily: 'SairaSemiCondensed-Bold', marginBottom: 4, letterSpacing: 0.3 },
  clientMiniStatBadge: { width: '100%', paddingHorizontal: 2, paddingVertical: 6, borderRadius: radius.xs, alignItems: 'center', justifyContent: 'center' },
  clientMiniStatCount: { fontSize: 10, fontFamily: 'SairaSemiCondensed-Bold' },

  expandedContent: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  expandedHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  expandedTitle: { fontSize: 8, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray400, letterSpacing: 0.5 },
  expandedItem: { flexDirection: 'column', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  expandedItemHeader: { marginBottom: 4 },
  expandedItemName: { fontSize: 11, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray800 },
  expandedItemGroup: { fontSize: 8, color: colors.gray400, fontFamily: 'SairaSemiCondensed-Medium' },
  statusButtonsRowBelow: { flexDirection: 'row', gap: 8, marginTop: 5, width: '100%' },
  stBtnBelow: { flex: 1, paddingVertical: 6, borderRadius: 3, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stBtnTextBelow: { fontSize: 8, fontFamily: 'SairaSemiCondensed-Bold', textAlign: 'center' },
});
