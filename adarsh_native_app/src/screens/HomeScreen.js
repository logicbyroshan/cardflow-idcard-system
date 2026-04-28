import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiGet } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { DashboardSkeleton } from '../components/Skeleton';
import { ErrorView, ErrorBanner, ERROR_TYPES } from '../components/NetworkGuard';
import { colors, gradients, shadows } from '../theme';

const STATUS_CONFIG = [
  { key: 'pending',  label: 'Pending',  icon: 'clock',        bg: '#fef3c7', text: '#b45309', border: '#fde68a' },
  { key: 'verified', label: 'Verified', icon: 'check-circle', bg: '#d1fae5', text: '#047857', border: '#a7f3d0' },
  { key: 'approved', label: 'Approved', icon: 'check-double',  bg: '#e0f2fe', text: '#0369a1', border: '#bae6fd' },
  { key: 'download', label: 'Download', icon: 'download',      bg: '#ede9fe', text: '#7c3aed', border: '#ddd6fe' },
  { key: 'pool',     label: 'Pool',     icon: 'inbox',         bg: '#fce7f3', text: '#be185d', border: '#fbcfe8' },
  { key: 'total',    label: 'Total',    icon: 'id-card',       bg: 'rgba(51,183,239,0.1)', text: colors.brandLight, border: 'rgba(51,183,239,0.3)' },
];

export default function HomeScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const loadDashboard = useCallback(async () => {
    try {
      setError(null);
      const { data } = await apiGet('/app/api/dashboard/');
      if (data?.success) setCounts(data.data || {});
      else setError('Failed to load dashboard data');
    } catch (e) {
      setError(e.message?.includes('Network') ? 'network' : 'server');
    }
  }, []);

  useEffect(() => { (async () => { await loadDashboard(); setLoading(false); })(); }, []);

  const onRefresh = useCallback(async () => { setRefreshing(true); await loadDashboard(); setRefreshing(false); }, [loadDashboard]);

  const totalCards = useMemo(() => STATUS_CONFIG.filter(s => s.key !== 'total').reduce((sum, s) => sum + (counts[s.key] || 0), 0), [counts]);

  if (loading) return (
    <View style={s.root}>
      <LinearGradient colors={gradients.brand} style={[s.header, { paddingTop: insets.top + 12 }]}>
        <Text style={s.headerTitle}>Adarsh ID Cards</Text>
      </LinearGradient>
      <DashboardSkeleton />
    </View>
  );

  if (error && !counts.pending && !refreshing) return (
    <View style={s.root}>
      <LinearGradient colors={gradients.brand} style={[s.header, { paddingTop: insets.top + 12 }]}>
        <Text style={s.headerTitle}>Adarsh ID Cards</Text>
      </LinearGradient>
      <ErrorView 
        type={error === 'network' ? ERROR_TYPES.NETWORK : ERROR_TYPES.SERVER} 
        onRetry={loadDashboard}
        message={typeof error === 'string' && error !== 'network' && error !== 'server' ? error : null}
      />
    </View>
  );

  return (
    <View style={s.root}>
      {/* Header */}
      <LinearGradient colors={gradients.brandFull} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={[s.header, { paddingTop: insets.top + 12 }]}>
        <View style={s.headerRow}>
          <View>
            <Text style={s.greeting}>Welcome back,</Text>
            <Text style={s.headerTitle}>{user?.name || 'User'}</Text>
          </View>
          <View style={s.headerBtns}>
            <TouchableOpacity onPress={() => navigation.navigate('Notifications')} style={s.headerBtn}><FontAwesome5 name="bell" size={14} color="#fff" solid /></TouchableOpacity>
            <TouchableOpacity onPress={() => navigation.navigate('Profile')} style={s.headerBtn}><FontAwesome5 name="user" size={14} color="#fff" solid /></TouchableOpacity>
          </View>
        </View>
        </View>
        {/* Full Search Bar */}
        <TouchableOpacity 
          style={s.searchBar} 
          activeOpacity={0.8}
          onPress={() => navigation.navigate('Search')}
        >
          <FontAwesome5 name="search" size={12} color="rgba(255,255,255,0.6)" />
          <Text style={s.searchPlaceholder}>Search for cards, names, numbers...</Text>
        </TouchableOpacity>
      </LinearGradient>

      <ScrollView style={s.scroll} contentContainerStyle={s.scrollC} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandLight} />}>

        {error && <ErrorBanner message={error === 'network' ? 'Connection lost' : 'Failed to sync latest data'} onDismiss={() => setError(null)} onRetry={loadDashboard} />}

        {/* Status Cards Grid */}
        <Text style={s.secTitle}>CARD STATUS</Text>
        <View style={s.statusGrid}>
          {STATUS_CONFIG.map(st => {
            const countValue = st.key === 'total' ? totalCards : (counts[st.key] || 0);
            return (
              <TouchableOpacity key={st.key} style={[s.statusCard, { borderColor: st.border }]} activeOpacity={0.7}
                onPress={() => navigation.navigate('TablePicker', { status: st.key === 'total' ? 'pending' : st.key })}>
                <View style={[s.statusIcon, { backgroundColor: st.bg }]}>
                  <FontAwesome5 name={st.icon} size={14} color={st.text} solid />
                </View>
                <Text style={[s.statusCount, { color: st.text }]}>{countValue.toLocaleString()}</Text>
                <Text style={s.statusLabel}>{st.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Groups/Tables Section */}
        <Text style={s.secTitle}>GROUPS / TABLES</Text>
        <View style={s.tablesContainer}>
          {counts.tables && counts.tables.length > 0 ? (
            counts.tables.map(table => (
              <View key={table.id} style={s.tableListItem}>
                <View style={s.tableHeader}>
                  <View style={s.tableIconMain}><FontAwesome5 name="table" size={14} color={colors.brandLight} /></View>
                  <Text style={s.tableListItemName}>{table.name}</Text>
                </View>
                <View style={s.tableActionsRow}>
                  {[
                    { key: 'pending',  label: 'Pending',  bg: '#fef3c7', text: '#b45309' },
                    { key: 'verified', label: 'Verified', bg: '#d1fae5', text: '#047857' },
                    { key: 'approved', label: 'Approved', bg: '#e0f2fe', text: '#0369a1' },
                    { key: 'download', label: 'Download', bg: '#ede9fe', text: '#7c3aed' },
                    { key: 'pool',     label: 'Pool',     bg: '#fce7f3', text: '#be185d' },
                  ].map(st => (
                    <TouchableOpacity 
                      key={st.key} 
                      style={[s.statusPillBtn, { backgroundColor: st.bg }]} 
                      onPress={() => navigation.navigate('CardList', { tableId: table.id, status: st.key })}
                    >
                      <Text style={[s.statusPillLabel, { color: st.text }]}>{st.label}</Text>
                      <Text style={[s.statusPillCount, { color: st.text }]}>{table[st.key] || 0}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ))
          ) : (
            <View style={s.emptyTables}><Text style={s.emptyTablesText}>No tables found</Text></View>
          )}
          
          <TouchableOpacity 
            style={s.viewAllBtn} 
            activeOpacity={0.7} 
            onPress={() => navigation.navigate('Groups')}
          >
            <Text style={s.viewAllBtnText}>View All Groups & Details</Text>
            <FontAwesome5 name="arrow-right" size={10} color={colors.brandLight} />
          </TouchableOpacity>
        </View>

        {/* Recent Activity */}
        {counts.recent_activity && counts.recent_activity.length > 0 && (
          <>
            <Text style={s.secTitle}>RECENT ACTIVITY</Text>
            <View style={s.activityCard}>
              {counts.recent_activity.slice(0, 8).map((a, i) => (
                <View key={i} style={s.actRow}>
                  <View style={s.actDot} />
                  <View style={s.actInfo}>
                    <Text style={s.actName} numberOfLines={1}>{a.name}</Text>
                    <Text style={s.actMeta}>{a.table_name} · {a.time_ago}</Text>
                  </View>
                  <View style={[s.actPill, { backgroundColor: STATUS_CONFIG.find(x => x.key === a.status)?.bg || '#f3f4f6' }]}>
                    <Text style={[s.actPillText, { color: STATUS_CONFIG.find(x => x.key === a.status)?.text || '#6b7280' }]}>{a.status}</Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceBg },
  loadWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { paddingHorizontal: 16, paddingBottom: 20 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  greeting: { fontSize: 12, color: 'rgba(255,255,255,0.7)' },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#fff' },
  headerBtns: { flexDirection: 'row', gap: 8 },
  headerBtn: { width: 36, height: 36, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  searchPlaceholder: { fontSize: 13, color: 'rgba(255,255,255,0.6)' },
  scroll: { flex: 1 }, scrollC: { paddingBottom: 40 },
  secTitle: { fontSize: 10, fontWeight: '700', color: colors.gray400, letterSpacing: 1.2, marginHorizontal: 20, marginTop: 16, marginBottom: 8 },
  // Status Grid
  statusGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 16 },
  statusCard: { width: '31%', backgroundColor: '#fff', borderRadius: 16, padding: 12, alignItems: 'center', borderWidth: 1.5, ...shadows.sm },
  statusIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  statusCount: { fontSize: 18, fontWeight: '800' },
  statusLabel: { fontSize: 10, fontWeight: '600', color: colors.gray400, marginTop: 2 },
  // Tables Section
  tablesContainer: { paddingHorizontal: 16, gap: 12 },
  tableListItem: { backgroundColor: '#fff', borderRadius: 20, padding: 14, borderWidth: 1, borderColor: '#e2e8f0', ...shadows.sm },
  tableHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  tableIconMain: { width: 32, height: 32, borderRadius: 8, backgroundColor: 'rgba(51,183,239,0.08)', alignItems: 'center', justifyContent: 'center' },
  tableListItemName: { fontSize: 14, fontWeight: '700', color: colors.gray800 },
  tableActionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  statusPillBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8, minWidth: '31%' },
  statusPillLabel: { fontSize: 9, fontWeight: '700' },
  statusPillCount: { fontSize: 11, fontWeight: '800' },
  viewAllBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, backgroundColor: 'rgba(51,183,239,0.05)', borderRadius: 16, borderDash: [4, 4], borderStyle: 'dashed', borderWidth: 1, borderColor: 'rgba(51,183,239,0.3)', marginTop: 4 },
  viewAllBtnText: { fontSize: 12, fontWeight: '700', color: colors.brandLight },
  emptyTables: { padding: 20, alignItems: 'center' },
  emptyTablesText: { fontSize: 12, color: colors.gray400 },
  // Activity
  activityCard: { marginHorizontal: 16, backgroundColor: '#fff', borderRadius: 20, borderWidth: 1, borderColor: '#e2e8f0', overflow: 'hidden', ...shadows.sm },
  actRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f9fafb' },
  actDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.brandLight },
  actInfo: { flex: 1, minWidth: 0 },
  actName: { fontSize: 12, fontWeight: '600', color: colors.gray800 },
  actMeta: { fontSize: 10, color: colors.gray400, marginTop: 1 },
  actPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  actPillText: { fontSize: 9, fontWeight: '700', textTransform: 'capitalize' },
});
