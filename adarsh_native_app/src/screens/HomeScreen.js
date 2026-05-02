import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, Dimensions, Image } from 'react-native';
const { width } = Dimensions.get('window');
import { FontAwesome5 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiGet } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { DashboardSkeleton } from '../components/Skeleton';
import { ErrorView, ErrorBanner, ERROR_TYPES } from '../components/NetworkGuard';
import StatusBadge from '../components/StatusBadge';
import { colors, gradients, shadows, radius, fontFamily, roleThemes } from '../theme';

const STATUS_CONFIG = [
  { key: 'pending',  label: 'Pending',  icon: 'clock',        bg: '#fbbf24', bg2: '#f59e0b', text: '#fff', border: 'transparent' },
  { key: 'verified', label: 'Verified', icon: 'check-circle', bg: '#34d399', bg2: '#10b981', text: '#fff', border: 'transparent' },
  { key: 'approved', label: 'Approved', icon: 'check-double', bg: '#60a5fa', bg2: '#3b82f6', text: '#fff', border: 'transparent' },
  { key: 'download', label: 'Download', icon: 'download',     bg: '#a855f7', bg2: '#7e22ce', text: '#fff', border: 'transparent' },
  { key: 'pool',     label: 'Pool',     icon: 'inbox',        bg: '#ef4444', bg2: '#dc2626', text: '#fff', border: 'transparent' },
  { key: 'reprint',  label: 'Reprint',  icon: 'redo',         bg: '#f97316', bg2: '#ea580c', text: '#fff', border: 'transparent' },
  { key: 'total',    label: 'Total',    icon: 'id-card',      bg: '#334155', bg2: '#1e293b', text: '#fff', border: 'transparent' },
];
const STATUS_LABELS = { pending: 'Pending', verified: 'Verified', approved: 'Approved', download: 'Download', pool: 'Pool', reprint: 'Reprint' };

const GRID_PADDING = 16;
const GRID_GAP = 10;
const CARD_SIZE = Math.floor((width - (GRID_PADDING * 2) - (GRID_GAP * 2)) - 2) / 3; // 3 square cards per row

export default function HomeScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
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
      else setError(data?.message || 'Failed to load dashboard data');
    } catch (e) {
      setError(e.message?.includes('Network') ? 'network' : 'server');
    }
  }, []);

  useEffect(() => { (async () => { await loadDashboard(); setLoading(false); })(); }, []);
  const onRefresh = useCallback(async () => { setRefreshing(true); await loadDashboard(); setRefreshing(false); }, [loadDashboard]);
  const totalCards = useMemo(() => STATUS_CONFIG.filter(s => s.key !== 'total').reduce((sum, s) => sum + (counts[s.key] || 0), 0), [counts]);
  
  const quickActions = useMemo(() => {
    const actions = [
      { label: 'Notifications', icon: 'bell', color: '#f59e0b', bg: '#fffbeb', screen: 'Notifications' },
      { label: 'Settings', icon: 'cog', color: '#6366f1', bg: '#eef2ff', screen: 'Settings' },
    ];

    const perms = user?.permissions || {};
    const isAdmin = user?.role === 'super_admin' || user?.role === 'admin_staff';

    if (user?.can_manage_staff || perms.perm_manage_client_staff || isAdmin) {
      actions.push({ label: 'Assistants', icon: 'users', color: '#8b5cf6', bg: '#f5f3ff', screen: 'StaffManage' });
    }

    if (user?.can_manage_clients || perms.perm_idcard_client_list || isAdmin) {
      actions.push({ label: 'Clients', icon: 'building', color: '#3b82f6', bg: '#eff6ff', screen: 'ClientsList' });
    }

    const hasReprintPerm = perms.perm_idcard_reprint_list || perms.perm_reprint_request_list || perms.perm_confirmed_list;
    if (hasReprintPerm || isAdmin) {
      actions.push({ label: 'Reprint', icon: 'redo', color: '#f97316', bg: '#fff7ed', screen: 'Reprint', params: { clientId: counts.client_id || user?.client_id } });
    }

    if (perms.perm_permission_list || isAdmin) {
      actions.push({ label: 'Perms', icon: 'shield-alt', color: '#22c55e', bg: '#f0fdf4', screen: 'Permissions' });
    }

    return actions;
  }, [user, counts]);

  if (loading) return (
    <View style={s.root}>
      <LinearGradient colors={gradients.brand} style={[s.header, { paddingTop: insets.top + 12 }]}>
        <Text style={s.headerTitle}>Loading...</Text>
      </LinearGradient>
      <DashboardSkeleton />
    </View>
  );

  if (error && !counts.pending && !refreshing) return (
    <View style={s.root}>
      <LinearGradient colors={gradients.brand} style={[s.header, { paddingTop: insets.top + 12 }]}>
        <Text style={s.headerTitle}>Adarsh ID Cards</Text>
      </LinearGradient>
      <ErrorView type={error === 'network' ? ERROR_TYPES.NETWORK : ERROR_TYPES.SERVER} onRetry={loadDashboard}
        message={typeof error === 'string' && error !== 'network' && error !== 'server' ? error : null} />
    </View>
  );

  return (
    <View style={s.root}>
      {/* Gradient Header */}
      <LinearGradient colors={gradients.brandFull} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={[s.header, { paddingTop: insets.top + 12 }]}>
        <View style={s.headerRow}>
          <TouchableOpacity style={s.headerLeft} onPress={() => navigation.navigate('Landing')} activeOpacity={0.8}>
            <Image source={require('../../assets/logo.png')} style={s.logo} resizeMode="contain" />
          </TouchableOpacity>

          <View style={s.headerCenter}>
            <Text style={s.brandName}>Adarsh ID Cards</Text>
          </View>

          <View style={s.headerRight}>
            <TouchableOpacity style={s.profileBtn} onPress={() => navigation.navigate('Profile')}>
              <FontAwesome5 name="user-alt" size={14} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
        <TouchableOpacity style={s.searchBar} activeOpacity={0.8} onPress={() => navigation.navigate('Search')}>
          <FontAwesome5 name="search" size={13} color="rgba(255,255,255,0.5)" />
          <Text style={s.searchPlaceholder}>Search for cards, names, numbers...</Text>
        </TouchableOpacity>
      </LinearGradient>

      <ScrollView style={s.scroll} contentContainerStyle={s.scrollC} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandLight} />}>

        {error && <ErrorBanner message={error === 'network' ? 'Connection lost' : 'Sync failed'} onDismiss={() => setError(null)} onRetry={loadDashboard} />}

        {/* 3×2 Status Grid — square boxes */}
        <View style={s.statusGrid}>
          {STATUS_CONFIG.map(st => {
            const val = st.key === 'total' ? totalCards : (counts[st.key] || 0);
            return (
              <TouchableOpacity 
                key={st.key} 
                onPress={() => {
                  if (st.key === 'total') {
                    const totalTables = (counts.tables || []).length;
                    if (totalTables === 1) {
                      navigation.navigate('CardList', { tableId: counts.tables[0].id, status: 'all' });
                    } else {
                      navigation.navigate('Groups');
                    }
                    return;
                  }
                  
                  // Optimized navigation: If only 1 table has this status, skip Picker
                  const statusMap = { pending: 'p', verified: 'v', approved: 'a', download: 'd', pool: 'po', reprint: 'r' };
                  const tableKey = statusMap[st.key] || st.key;
                  const tablesWithStatus = (counts.tables || []).filter(t => (t[tableKey] || 0) > 0);
                  if (tablesWithStatus.length === 1) {
                    navigation.navigate('CardList', { tableId: tablesWithStatus[0].id, status: st.key });
                  } else if (tablesWithStatus.length === 0 && st.key === 'pending') {
                    // If no pending but only one table exists overall, go to it
                    if ((counts.tables || []).length === 1) {
                      navigation.navigate('CardList', { tableId: counts.tables[0].id, status: 'pending' });
                    } else {
                      navigation.navigate('TablePicker', { status: st.key });
                    }
                  } else {
                    navigation.navigate('TablePicker', { status: st.key });
                  }
                }}
                activeOpacity={0.7}
              >
                <LinearGradient
                  colors={[st.bg, st.bg2]}
                  start={{x:0, y:0}} end={{x:1, y:1}}
                  style={[s.statusCard, { borderColor: 'transparent' }]}
                >
                  <View style={[s.statusIcon, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
                    <FontAwesome5 name={st.icon} size={15} color="#fff" />
                  </View>
                  <Text style={[s.statusCount, { color: '#fff' }]}>{val.toLocaleString()}</Text>
                  <Text style={[s.statusLabel, { color: 'rgba(255,255,255,0.85)' }]}>{st.label}</Text>
                </LinearGradient>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Tables section */}
        <LinearGradient 
          colors={gradients.brand} 
          start={{x:0, y:0}} end={{x:1, y:0}} 
          style={[s.secHeader, { marginTop: 12 }]}
        >
          <Text style={[s.secTitle, { color: '#fff' }]}>MY GROUPS/TABLES</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Groups')} style={s.viewAllBtn}>
            <Text style={[s.viewAllText, { color: 'rgba(255,255,255,0.9)' }]}>VIEW ALL</Text>
            <FontAwesome5 name="chevron-right" size={9} color="rgba(255,255,255,0.8)" />
          </TouchableOpacity>
        </LinearGradient>

        <View style={s.tablesWrap}>
          {counts.tables && counts.tables.length > 0 ? (
            counts.tables.map(table => (
              <View key={table.id} style={s.tableCard}>
                <View style={s.tableTop}>
                  <View style={[s.tableIcon, { backgroundColor: theme.bgSoft }]}>
                    <FontAwesome5 name="table" size={13} color={theme.primary} />
                  </View>
                  <Text style={s.tableName} numberOfLines={1}>{table.name}</Text>
                </View>
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
                      <StatusBadge status={st.status} count={table[st.key] || 0} variant="glass" />
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ))
          ) : (
            <View style={s.emptyTables}><Text style={s.emptyText}>No tables found</Text></View>
          )}
        </View>

        {/* Quick Actions */}
        {quickActions.length > 0 && (
          <>
            <View style={[s.secHeader, { marginTop: 12 }]}>
              <Text style={s.secTitle}>QUICK ACTIONS</Text>
            </View>
            <View style={s.quickActionsWrap}>
              {quickActions.map((act, i) => (
                <TouchableOpacity 
                  key={i} 
                  style={s.actionBox} 
                  onPress={() => navigation.navigate(act.screen, act.params)}
                >
                  <View style={[s.actionIcon, { backgroundColor: act.bg }]}>
                    <FontAwesome5 name={act.icon} size={18} color={act.color} solid />
                  </View>
                  <Text style={s.actionLabel}>{act.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Global Add Button (FAB) */}
      {(user?.role === 'super_admin' || user?.permissions?.perm_idcard_add) && (
        <TouchableOpacity 
          style={s.fab} 
          onPress={() => {
            const tables = counts.tables || [];
            if (tables.length === 1) {
              navigation.navigate('CardList', { tableId: tables[0].id, showAdd: true });
            } else {
              navigation.navigate('TablePicker', { action: 'add' });
            }
          }}
          activeOpacity={0.8}
        >
          <LinearGradient colors={gradients.brand} style={s.fabGradient}>
            <FontAwesome5 name="plus" size={18} color="#fff" />
          </LinearGradient>
        </TouchableOpacity>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceBg },
  header: { paddingHorizontal: 20, paddingBottom: 24, borderBottomLeftRadius: radius.xl, borderBottomRightRadius: radius.xl, ...shadows.lg },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  headerLeft: { width: 40 },
  headerCenter: { flex: 1, alignItems: 'center' },
  brandName: { fontSize: 20, fontFamily: fontFamily.black, color: '#fff', letterSpacing: 0.5 },
  headerRight: { width: 40, alignItems: 'flex-end' },
  profileBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  logo: { width: 32, height: 32, borderRadius: radius.sm },
  headerTitle: { fontSize: 18, fontFamily: fontFamily.bold, color: '#fff' },
  
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: radius.lg, paddingHorizontal: 16, paddingVertical: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  searchPlaceholder: { color: 'rgba(255,255,255,0.6)', fontSize: 13, marginLeft: 10, fontFamily: fontFamily.medium },

  scroll: { flex: 1 },
  scrollC: { padding: 16 },

  statusGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10, marginBottom: 8 },
  statusCard: { width: '48.5%', aspectRatio: 1.1, borderRadius: radius.xl, padding: 16, justifyContent: 'space-between', ...shadows.md, borderWidth: 1, borderColor: colors.gray100 },
  statusIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  statusCount: { fontSize: 24, fontFamily: fontFamily.black, color: colors.gray800 },
  statusLabel: { fontSize: 12, fontFamily: fontFamily.bold, color: colors.gray400, textTransform: 'uppercase', letterSpacing: 0.5 },

  secHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.lg, marginBottom: 12, backgroundColor: '#fff', ...shadows.sm },
  secTitle: { fontSize: 11, fontFamily: fontFamily.black, color: colors.gray400, letterSpacing: 1.5 },
  viewAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  viewAllText: { fontSize: 10, fontFamily: fontFamily.bold, color: colors.brandPrimary },

  tablesWrap: { gap: 10, marginBottom: 8 },
  tableCard: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 12, ...shadows.sm, borderWidth: 1, borderColor: colors.gray100 },
  tableTop: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  tableIcon: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  tableName: { fontSize: 14, fontFamily: fontFamily.bold, color: colors.gray800, flex: 1 },
  tablePills: { flexDirection: 'row', gap: 4, justifyContent: 'space-between' },
  pillBtn: { flex: 1, alignItems: 'center', minWidth: 0 },
  pillLabel: { fontSize: 7, fontFamily: fontFamily.bold, color: colors.gray400, marginBottom: 4, textTransform: 'uppercase' },

  quickActionsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 4 },
  actionBox: { width: '23%', alignItems: 'center', marginBottom: 16 },
  actionIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  actionLabel: { fontSize: 10, fontFamily: fontFamily.bold, color: colors.gray700, textAlign: 'center' },

  fab: {
    position: 'absolute',
    bottom: 30,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    ...shadows.xl,
    zIndex: 1000,
  },
  fabGradient: {
    width: '100%',
    height: '100%',
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTables: { padding: 40, alignItems: 'center' },
  emptyText: { color: colors.gray400, fontSize: 13, fontFamily: fontFamily.medium },
});
