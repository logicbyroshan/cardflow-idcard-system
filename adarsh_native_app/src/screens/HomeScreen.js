import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, Dimensions, Image } from 'react-native';
const { width } = Dimensions.get('window');
import { DynamicIcon, IconPending, IconVerified, IconApproved, IconDownload, IconPool, IconTotal, IconSearch, IconProfile } from '../components/Icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiGet } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { DashboardSkeleton } from '../components/Skeleton';
import { ErrorView, ErrorBanner, ERROR_TYPES } from '../components/NetworkGuard';
import StatusBadge from '../components/StatusBadge';
import { colors, gradients, shadows, radius, fontFamily, roleThemes } from '../theme';
import useRefreshableResource from '../hooks/useRefreshableResource';

// Status cards: 6 cards (without Reprint)
const STATUS_CONFIG = [
  { key: 'pending',  label: 'Pending',   Svg: IconPending,   bg: '#f59e0b', bg2: '#d97706' },
  { key: 'verified', label: 'Verified',  Svg: IconVerified,  bg: '#10b981', bg2: '#059669' },
  { key: 'approved', label: 'Approved',  Svg: IconApproved,  bg: '#3b82f6', bg2: '#2563eb' },
  { key: 'download', label: 'Download',  Svg: IconDownload,  bg: '#8b5cf6', bg2: '#7c3aed' },
  { key: 'pool',     label: 'Pool',      Svg: IconPool,      bg: '#ef4444', bg2: '#b91c1c' },
  { key: 'total',    label: 'All Cards', Svg: IconTotal,     bg: '#1e293b', bg2: '#0f172a' },
];

export default function HomeScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const theme = roleThemes[user?.role] || roleThemes.default;
  const [expandedClient, setExpandedClient] = useState(null);

  const isSuperAdmin = !!user?.isSuperAdmin;
  const isOperator = !!user?.isOperator;
  const isAdmin = !!user?.isAdmin;
  const isClient = !!user?.isClient;
  const isAssistant = !!user?.isAssistant;

  const loadDashboard = useCallback(async () => {
    try {
      const { ok, data } = await apiGet('/api/mobile/dashboard/');
      if (!ok || !data?.success) {
        throw new Error(data?.message || 'Failed to load dashboard data');
      }
      return data.data || {};
    } catch (e) {
      throw new Error(e.message?.includes('Network') ? 'network' : 'server');
    }
  }, []);

  const { data: counts = {}, loading, refreshing, error, refresh } = useRefreshableResource(loadDashboard, { initialData: {} });
  // totalCards should come from the backend 'total' field if available, or sum of specific statuses
  const totalCards = counts.total || STATUS_CONFIG.filter(s => s.key !== 'total' && s.key !== 'pool').reduce((sum, s) => sum + (counts[s.key] || 0), 0);
  
  // New Quick Actions Logic
  const quickActions = useMemo(() => {
    const actions = [
      { label: 'Notifications', icon: 'bell-outline', lib: 'MaterialCommunityIcons', color: '#f59e0b', bg: '#fffbeb', screen: 'Notifications' },
      { label: 'Settings', icon: 'cog-outline', lib: 'MaterialCommunityIcons', color: '#6366f1', bg: '#eef2ff', screen: 'Settings' },
    ];

    const perms = user?.permissions || {};
    const hasReprintPerm = perms.perm_idcard_reprint_list || perms.perm_reprint_request_list || perms.perm_confirmed_list;

    if (isSuperAdmin) {
      // ADMIN: All actions
      actions.push({ label: 'Reprint', icon: 'redo', color: '#f97316', bg: '#fff7ed', screen: 'Reprint', params: { clientId: 0 } });
      actions.push({ label: 'Manage Client', icon: 'building', color: '#3b82f6', bg: '#eff6ff', screen: 'ClientsList' });
      actions.push({ label: 'Manage Assistant', icon: 'users', color: '#8b5cf6', bg: '#f5f3ff', screen: 'StaffManage' });
      actions.push({ label: 'Manage Operator', icon: 'user-tie', color: '#10b981', bg: '#ecfdf5', screen: 'StaffManage' });
      actions.push({ label: 'Manage Panel', icon: 'sliders-h', color: '#ef4444', bg: '#fef2f2', screen: 'DesktopRequired' });
      actions.push({ label: 'Pro Feature', icon: 'star', color: '#a855f7', bg: '#faf5ff', screen: 'DesktopRequired' });
    } else if (isOperator) {
      // OPERATOR: Reprint + Manage Clients
      actions.push({ label: 'Reprint', icon: 'redo', color: '#f97316', bg: '#fff7ed', screen: 'Reprint', params: { clientId: 0 } });
      actions.push({ label: 'Manage Clients', icon: 'building', color: '#3b82f6', bg: '#eff6ff', screen: 'ClientsList' });
    } else if (isClient) {
      // CLIENT: Conditional Reprint + Manage Assistant (if permitted)
      if (hasReprintPerm) {
        actions.push({ label: 'Reprint', icon: 'redo', color: '#f97316', bg: '#fff7ed', screen: 'Reprint', params: { clientId: user?.client_id } });
      }
      if (perms.perm_manage_client_staff) {
        actions.push({ label: 'Manage Assistant', icon: 'users', color: '#8b5cf6', bg: '#f5f3ff', screen: 'StaffManage' });
      }
    } else if (isAssistant) {
      // ASSISTANT: Only Reprint if permitted
      if (hasReprintPerm) {
        actions.push({ label: 'Reprint', icon: 'redo', color: '#f97316', bg: '#fff7ed', screen: 'Reprint', params: { clientId: user?.client_id } });
      }
    }

    return actions;
  }, [user, counts, isSuperAdmin, isOperator, isClient, isAssistant]);

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
      <ErrorView type={error === 'network' ? ERROR_TYPES.NETWORK : ERROR_TYPES.SERVER} onRetry={refresh}
        message={typeof error === 'string' && error !== 'network' && error !== 'server' ? error : null} />
    </View>
  );

  return (
    <View style={s.root}>
      {/* Header: Left Icon - Center Name - Right Profile */}
      <LinearGradient colors={gradients.brandFull} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={[s.header, { paddingTop: insets.top + 12 }]}>
        <View style={s.headerRow}>
          <TouchableOpacity style={s.headerLeftBtn} onPress={() => navigation.navigate('Landing')} activeOpacity={0.8}>
            <Image source={require('../../assets/logo.png')} style={s.logo} resizeMode="contain" />
          </TouchableOpacity>
          <View style={s.headerCenter}>
            <Text style={s.brandName}>Adarsh ID Cards</Text>
          </View>
          <View style={s.headerRight}>
            <TouchableOpacity style={s.profileBtn} onPress={() => navigation.navigate('Profile')}>
              <IconProfile size={14} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
        
        {/* Search Bar */}
        <TouchableOpacity style={s.searchBar} activeOpacity={0.8} onPress={() => navigation.navigate('Search')}>
          <IconSearch size={13} color="rgba(255,255,255,0.5)" />
          <Text style={s.searchPlaceholder}>Search cards, names, numbers...</Text>
        </TouchableOpacity>
      </LinearGradient>

      <ScrollView style={s.scroll} contentContainerStyle={s.scrollC} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.brandLight} />}>

        {error && <ErrorBanner message={error === 'network' ? 'Connection lost' : 'Sync failed'} onDismiss={refresh} onRetry={refresh} />}

        {/* Status Grid: Premium Gradient Cards */}
        <View style={s.statusGrid}>
          {STATUS_CONFIG.map(st => {
            const val = st.key === 'total' ? totalCards : (counts[st.key] || 0);
            return (
              <TouchableOpacity 
                key={st.key} 
                style={s.statusCardOuter}
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
                  
                  const statusMap = { pending: 'p', verified: 'v', approved: 'a', download: 'd', pool: 'po', reprint: 'r' };
                  const tableKey = statusMap[st.key] || st.key;
                  const tablesWithStatus = (counts.tables || []).filter(t => (t[tableKey] || 0) > 0);
                  if (tablesWithStatus.length === 1) {
                    navigation.navigate('CardList', { tableId: tablesWithStatus[0].id, status: st.key });
                  } else {
                    navigation.navigate('TablePicker', { status: st.key });
                  }
                }}
                activeOpacity={0.8}
              >
                <LinearGradient
                  colors={[st.bg, st.bg2]}
                  start={{x:0, y:0}} end={{x:1, y:1}}
                  style={s.statusCard}
                >
                  <View style={s.statusCardContent}>
                    <View style={s.statusIconCircle}>
                      <st.Svg size={20} color="#fff" />
                    </View>
                    <View style={s.statusInfo}>
                      <Text style={s.statusCount}>{val.toLocaleString()}</Text>
                      <Text style={s.statusLabel}>{st.label.toUpperCase()}</Text>
                    </View>
                  </View>
                  {/* Decorative element */}
                  <View style={s.cardDecor} />
                </LinearGradient>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Groups/Tables Section: Common for all, different content */}
        <LinearGradient 
          colors={gradients.brand} 
          start={{x:0, y:0}} end={{x:1, y:0}} 
          style={[s.secHeader, { marginTop: 12 }]}
        >
          <Text style={[s.secTitle, { color: '#fff' }]}>
            {isAdmin ? 'MY CLIENTS' : 'MY TABLES'}
          </Text>
        </LinearGradient>

        <View style={s.groupsWrap}>
          {isAdmin ? (
            // ADMIN/OPERATOR: Show clients with expandable tables
            counts.recent_clients && counts.recent_clients.length > 0 ? (
              counts.recent_clients.map(client => (
                <View key={client.id} style={s.clientCard}>
                  <TouchableOpacity 
                    style={s.clientHeader}
                    onPress={() => setExpandedClient(expandedClient === client.id ? null : client.id)}
                  >
                    <View style={[s.clientIcon, { backgroundColor: theme.bgSoft }]}>
                      <DynamicIcon name="user-circle" size={14} color={theme.primary} />
                    </View>
                    <View style={s.clientInfo}>
                      <Text style={s.clientName} numberOfLines={1}>{client.name}</Text>
                      <View style={s.badgeRow}>
                        <StatBadge label="P" count={client.pending || 0} theme={colors.pending} />
                        <StatBadge label="V" count={client.verified || 0} theme={colors.verified} />
                        <StatBadge label="A" count={client.approved || 0} theme={colors.approved} />
                        <StatBadge label="D" count={client.download || 0} theme={colors.download} />
                      </View>
                    </View>
                    <DynamicIcon 
                      name={expandedClient === client.id ? 'chevron-up' : 'chevron-down'} 
                      size={12} 
                      color={colors.gray400}
                    />
                  </TouchableOpacity>
                  
                  {/* Expanded Tables */}
                  {expandedClient === client.id && client.tables && client.tables.length > 0 && (
                    <View style={s.expandedTables}>
                      {client.tables.map(table => (
                        <TouchableOpacity 
                          key={table.id}
                          style={s.tableRow}
                          onPress={() => navigation.navigate('CardList', { tableId: table.id, status: 'all' })}
                        >
                          <DynamicIcon name="table" size={11} color={colors.gray400} style={{ marginRight: 8 }} />
                          <Text style={s.tableRowName} numberOfLines={1}>{table.name}</Text>
                          <View style={s.tableRowStats}>
                            <Text style={s.tableStat}>P:{table.p || 0}</Text>
                            <Text style={s.tableStat}>V:{table.v || 0}</Text>
                          </View>
                        </TouchableOpacity>
                      ))}
                      <TouchableOpacity 
                        style={[s.tableRow, { justifyContent: 'center', backgroundColor: '#f1f5f9' }]}
                        onPress={() => navigation.navigate('ClientGroups', { clientId: client.id, clientName: client.name })}
                      >
                        <Text style={[s.tableRowName, { flex: 0, fontSize: 10, color: colors.brandPrimary, fontWeight: '700' }]}>VIEW ALL TABLES</Text>
                        <DynamicIcon name="arrow-right" size={8} color={colors.brandPrimary} style={{ marginLeft: 6 }} />
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              ))
            ) : (
              <View style={s.emptyState}><Text style={s.emptyText}>No recent clients found</Text></View>
            )
          ) : (
            // CLIENT/ASSISTANT: Show tables
            counts.tables && counts.tables.length > 0 ? (
              counts.tables.map(table => (
                <TouchableOpacity 
                  key={table.id}
                  style={s.tableCard}
                  onPress={() => navigation.navigate('CardList', { tableId: table.id, status: 'all' })}
                >
                  <View style={s.tableCardTop}>
                    <View style={[s.tableIcon, { backgroundColor: theme.bgSoft }]}>
                      <DynamicIcon name="table" size={13} color={theme.primary} />
                    </View>
                    <Text style={s.tableName} numberOfLines={1}>{table.name}</Text>
                  </View>
                  <View style={s.tableStats}>
                    <Text style={s.statBadge}>P: {table.p || 0}</Text>
                    <Text style={s.statBadge}>V: {table.v || 0}</Text>
                    <Text style={s.statBadge}>A: {table.a || 0}</Text>
                    <Text style={s.statBadge}>D: {table.d || 0}</Text>
                  </View>
                </TouchableOpacity>
              ))
            ) : (
              <View style={s.emptyState}><Text style={s.emptyText}>No tables found</Text></View>
            )
          )}
        </View>



        {/* Quick Actions */}
        {quickActions.length > 0 && (
          <>
            <LinearGradient 
              colors={gradients.brand} 
              start={{x:0, y:0}} end={{x:1, y:0}} 
              style={[s.secHeader, { marginTop: 16 }]}
            >
              <Text style={[s.secTitle, { color: '#fff' }]}>QUICK ACTIONS</Text>
            </LinearGradient>
            <View style={s.quickActionsWrap}>
              {quickActions.map((act, i) => (
                <TouchableOpacity 
                  key={i} 
                  style={s.actionBox} 
                  onPress={() => navigation.navigate(act.screen, act.params)}
                >
                  <View style={[s.actionIcon, { backgroundColor: act.bg }]}>
                    <DynamicIcon name={act.icon} size={18} color={act.color} />
                  </View>
                  <Text style={s.actionLabel} numberOfLines={2}>{act.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* FAB: Only Admin can add cards */}
      {(isSuperAdmin || user?.permissions?.perm_idcard_add) && (
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
            <DynamicIcon name="plus" size={18} color="#fff" />
          </LinearGradient>
        </TouchableOpacity>
      )}
    </View>
  );
}

function StatBadge({ label, count, theme }) {
  return (
    <View style={[s.badge, { backgroundColor: theme.bg, borderColor: theme.border }]}>
      <Text style={[s.badgeLabel, { color: theme.text }]}>{label}</Text>
      <Text style={[s.badgeCount, { color: theme.text }]}>{count}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceBg },
  header: { paddingHorizontal: 20, paddingBottom: 16, borderBottomLeftRadius: radius.xl, borderBottomRightRadius: radius.xl, ...shadows.lg },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  headerLeft: { width: 40 },
  headerLeftBtn: { width: 36, height: 36, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  headerCenter: { flex: 1, alignItems: 'center' },
  brandName: { fontSize: 20, fontFamily: fontFamily.black, color: '#fff', letterSpacing: 0.5 },
  headerRight: { width: 40, alignItems: 'flex-end' },
  profileBtn: { width: 36, height: 36, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  logo: { width: 24, height: 24 },
  headerTitle: { fontSize: 18, fontFamily: fontFamily.bold, color: '#fff' },
  
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: radius.lg, paddingHorizontal: 16, paddingVertical: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  searchPlaceholder: { color: 'rgba(255,255,255,0.6)', fontSize: 13, marginLeft: 10, fontFamily: fontFamily.medium },

  scroll: { flex: 1 },
  scrollC: { padding: 16 },

  statusGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingHorizontal: 0, marginTop: 16 },
  statusCardOuter: {
    width: (width - 48) / 3,
    aspectRatio: 1,
    marginBottom: 12,
    borderRadius: 16,
    overflow: 'hidden',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  statusCard: { flex: 1 },
  statusCardContent: { flex: 1, padding: 10, alignItems: 'center', justifyContent: 'center' },
  statusIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  statusInfo: { alignItems: 'center' },
  statusCount: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
    fontFamily: fontFamily.black,
  },
  statusLabel: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 9,
    fontWeight: '700',
    fontFamily: fontFamily.bold,
    marginTop: 1,
    letterSpacing: 0.3,
  },

  secHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.lg, marginBottom: 12, backgroundColor: '#fff', ...shadows.sm },
  secTitle: { fontSize: 11, fontFamily: fontFamily.black, color: colors.gray400, letterSpacing: 1.5 },

  // Groups/Tables Section
  groupsWrap: { marginBottom: 8 },
  
  // Client Card (Admin/Operator view)
  clientCard: { backgroundColor: '#fff', borderRadius: radius.lg, ...shadows.sm, borderWidth: 1, borderColor: colors.gray100, marginBottom: 12, overflow: 'hidden' },
  clientHeader: { flexDirection: 'row', alignItems: 'center', padding: 10, justifyContent: 'space-between' },
  clientIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  clientInfo: { flex: 1, minWidth: 0 },
  clientName: { fontSize: 13, fontFamily: fontFamily.bold, color: colors.gray800, marginBottom: 4 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  badge: { paddingHorizontal: 4, paddingVertical: 2, borderRadius: radius.xs, borderWidth: 0.5, alignItems: 'center', minWidth: 32 },
  badgeLabel: { fontSize: 6, fontFamily: fontFamily.bold },
  badgeCount: { fontSize: 10, fontFamily: fontFamily.bold },
  clientStats: { fontSize: 10, fontFamily: fontFamily.medium, color: colors.gray400, marginTop: 2 },
  
  // Expanded Tables
  expandedTables: { backgroundColor: colors.gray50, borderTopWidth: 1, borderTopColor: colors.gray100 },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.gray100 },
  tableRowName: { flex: 1, fontSize: 12, fontFamily: fontFamily.medium, color: colors.gray700 },
  tableRowStats: { flexDirection: 'row', gap: 6 },
  tableStat: { fontSize: 9, fontFamily: fontFamily.bold, color: colors.gray400 },

  // Table Card (Client/Assistant view)
  tableCard: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 12, ...shadows.sm, borderWidth: 1, borderColor: colors.gray100, marginBottom: 12 },
  tableCardTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  tableIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  tableName: { fontSize: 14, fontFamily: fontFamily.bold, color: colors.gray800, flex: 1 },
  tableStats: { flexDirection: 'row', justifyContent: 'space-between', gap: 6 },
  statBadge: { fontSize: 10, fontFamily: fontFamily.bold, color: '#fff', backgroundColor: colors.brandPrimary, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.md },

  // Quick Actions
  quickActionsWrap: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 0, gap: 12, marginBottom: 16 },
  actionBox: { width: '23%', alignItems: 'center' },
  actionIcon: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', marginBottom: 6, ...shadows.sm },
  actionLabel: { fontSize: 9, fontFamily: fontFamily.bold, color: colors.gray700, textAlign: 'center', lineHeight: 11 },



  // FAB
  fab: { position: 'absolute', bottom: 30, right: 20, width: 56, height: 56, borderRadius: 28, ...shadows.xl, zIndex: 1000 },
  fabGradient: { width: '100%', height: '100%', borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  
  emptyState: { padding: 40, alignItems: 'center' },
  emptyText: { color: colors.gray400, fontSize: 13, fontFamily: fontFamily.medium },
});
