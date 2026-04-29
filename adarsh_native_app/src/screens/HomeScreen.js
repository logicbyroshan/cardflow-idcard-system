import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiGet } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { DashboardSkeleton } from '../components/Skeleton';
import { ErrorView, ErrorBanner, ERROR_TYPES } from '../components/NetworkGuard';
import StatusBadge from '../components/StatusBadge';
import { colors, gradients, shadows, radius, roleThemes } from '../theme';

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
  const theme = roleThemes[user?.role] || roleThemes.default;

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
        <TouchableOpacity 
          style={s.searchBar} 
          activeOpacity={0.8}
          onPress={() => navigation.navigate('Search')}
        >
          <FontAwesome5 name="search" size={12} color="rgba(255,255,255,0.6)" />
          <Text style={s.searchPlaceholder}>Search for cards, names, numbers...</Text>
        </TouchableOpacity>
      </LinearGradient>
      <ScrollView 
        style={s.scroll} 
        contentContainerStyle={s.scrollC} 
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadDashboard(true)} tintColor={colors.brandLight} />}
      >
        <LinearGradient colors={theme.surface || ['#fff', '#f8fafc']} style={s.hero}>
          <View style={s.heroMain}>
            <View>
              <Text style={s.welcome}>Welcome back,</Text>
              <Text style={s.businessName} numberOfLines={1}>{counts.client_name || 'Adarsh User'}</Text>
            </View>
            <TouchableOpacity onPress={() => navigation.navigate('Profile')} style={[s.profileBtn, { backgroundColor: theme.primary + '15' }]}>
              <FontAwesome5 name="user-alt" size={14} color={theme.primary} />
            </TouchableOpacity>
          </View>

          <View style={[s.totalCard, { backgroundColor: theme.primary }]}>
            <LinearGradient colors={[theme.primary, theme.secondary || theme.primary]} start={{x:0, y:0}} end={{x:1, y:1}} style={s.totalCardGrad}>
              <View style={s.totalInfo}>
                <Text style={s.totalLabel}>TOTAL ACTIVE CARDS</Text>
                <Text style={s.totalValue}>{totalCards.toLocaleString()}</Text>
              </View>
              <View style={s.totalIconW}>
                <FontAwesome5 name="id-card" size={28} color="rgba(255,255,255,0.3)" />
              </View>
            </LinearGradient>
          </View>
        </LinearGradient>

        {error && <ErrorBanner message={error === 'network' ? 'Connection lost' : 'Failed to sync latest data'} onDismiss={() => setError(null)} onRetry={() => loadDashboard(true)} />}

        <View style={s.statusGrid}>
          {STATUS_CONFIG.map(st => {
            const countValue = counts[st.key] || 0;
            return (
              <TouchableOpacity key={st.key} style={[s.statusCard, { borderColor: st.border }]} activeOpacity={0.7}
                onPress={() => navigation.navigate('TablePicker', { status: st.key })}>
                <View style={[s.statusIcon, { backgroundColor: st.bg }]}>
                  <FontAwesome5 name={st.icon} size={14} color={st.text} solid />
                </View>
                <Text style={[s.statusCount, { color: st.text }]}>{countValue.toLocaleString()}</Text>
                <Text style={s.statusLabel}>{st.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={s.secHeader}>
          <Text style={s.secTitle}>MY TABLES</Text>
          <View style={[s.roleBadge, { backgroundColor: theme.bgSoft }]}>
            <Text style={[s.roleText, { color: theme.text }]}>{(user?.role || 'User').replace('_', ' ').toUpperCase()}</Text>
          </View>
        </View>

        <View style={s.tablesContainer}>
          {counts.tables && counts.tables.length > 0 ? (
            counts.tables.map(table => (
              <View key={table.id} style={s.tableCard}>
                <View style={s.tableHeader}>
                  <View style={[s.tableIconMain, { backgroundColor: theme.bgSoft }]}>
                    <FontAwesome5 name="table" size={12} color={theme.primary} />
                  </View>
                  <Text style={s.tableListItemName}>{table.name}</Text>
                </View>
                <View style={s.tableActionsRow}>
                  {[
                    { key: 'p', status: 'pending' },
                    { key: 'v', status: 'verified' },
                    { key: 'a', status: 'approved' },
                    { key: 'd', status: 'download' },
                  ].map(st => (
                    <TouchableOpacity 
                      key={st.key} 
                      style={s.statusPillBtn} 
                      onPress={() => navigation.navigate('CardList', { tableId: table.id, status: st.status })}
                    >
                      <StatusBadge status={st.status} count={table[st.key] || 0} variant="glass" />
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ))
          ) : (
            <View style={s.emptyTables}><Text style={s.emptyTablesText}>No tables found</Text></View>
          )}
          
          <TouchableOpacity style={s.viewAllBtn} activeOpacity={0.7} onPress={() => navigation.navigate('Groups')}>
            <Text style={s.viewAllBtnText}>View All Groups & Details</Text>
            <FontAwesome5 name="arrow-right" size={10} color={colors.brandLight} />
          </TouchableOpacity>
        </View>

        {counts.recent_activity && counts.recent_activity.length > 0 && (
          <View style={s.recentSection}>
            <Text style={s.secTitle}>RECENT UPDATES</Text>
            <View style={s.recentList}>
              {counts.recent_activity.slice(0, 8).map((act, i) => (
                <View key={i} style={s.activityRow}>
                  <View style={s.activityDot} />
                  <View style={s.activityBody}>
                    <Text style={s.activityName}>{act.name}</Text>
                    <Text style={s.activityMeta}>{act.table_name} · {act.time_ago} ago</Text>
                  </View>
                  <StatusBadge status={act.status} variant="glass" />
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceBg },
  scroll: { flex: 1 }, scrollC: { paddingBottom: 40 },
  hero: { padding: 20, borderBottomLeftRadius: 32, borderBottomRightRadius: 32, paddingBottom: 30, ...shadows.md },
  heroMain: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  welcome: { fontSize: 13, color: colors.gray500, fontWeight: '500' },
  businessName: { fontSize: 22, fontWeight: '800', color: colors.gray800, marginTop: 2 },
  profileBtn: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  totalCard: { borderRadius: 24, overflow: 'hidden', ...shadows.lg },
  totalCardGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20 },
  totalLabel: { fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.7)', letterSpacing: 1 },
  totalValue: { fontSize: 32, fontWeight: '900', color: '#fff', marginTop: 4 },
  totalIconW: { width: 56, height: 56, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  statusGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, padding: 16, marginTop: -20 },
  statusCard: { width: (width - 42) / 2, backgroundColor: '#fff', borderRadius: 20, padding: 16, borderWidth: 1, ...shadows.sm },
  statusIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  statusCount: { fontSize: 20, fontWeight: '800' },
  statusLabel: { fontSize: 11, fontWeight: '600', color: colors.gray400, marginTop: 2 },
  secHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginTop: 12, marginBottom: 12 },
  secTitle: { fontSize: 11, fontWeight: '800', color: colors.gray400, letterSpacing: 1.2 },
  roleBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  roleText: { fontSize: 9, fontWeight: '800' },
  tablesContainer: { paddingHorizontal: 16, gap: 12 },
  tableCard: { backgroundColor: '#fff', borderRadius: 20, padding: 16, borderWidth: 1, borderColor: '#f1f5f9', ...shadows.sm },
  tableHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  tableIconMain: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  tableListItemName: { fontSize: 14, fontWeight: '700', color: colors.gray800 },
  tableActionsRow: { flexDirection: 'row', gap: 8 },
  statusPillBtn: { flex: 1 },
  viewAllBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 16, backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#e2e8f0', marginTop: 8 },
  viewAllBtnText: { fontSize: 12, fontWeight: '700', color: colors.brandLight },
  emptyTables: { padding: 40, alignItems: 'center' },
  emptyTablesText: { color: colors.gray400, fontSize: 13 },
  recentSection: { marginTop: 24, paddingHorizontal: 16 },
  recentList: { backgroundColor: '#fff', borderRadius: 20, padding: 4, marginTop: 12, borderWidth: 1, borderColor: '#f1f5f9', ...shadows.sm },
  activityRow: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 12 },
  activityDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.brandLight },
  activityBody: { flex: 1 },
  activityName: { fontSize: 13, fontWeight: '700', color: colors.gray800 },
  activityMeta: { fontSize: 10, color: colors.gray400, marginTop: 2 },
});
