import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, Dimensions, Image
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  IconSearch, IconProfile, IconPending, IconVerified, IconApproved,
  IconDownload, IconPool, IconTotal, DynamicIcon
} from '../components/Icons';
import { colors, gradients, shadows, radius, fontFamily, roleThemes } from '../theme';
import { useAuth } from '../context/AuthContext';
import useRefreshableResource from '../hooks/useRefreshableResource';
import { apiGet } from '../api/client';
import { DashboardSkeleton } from '../components/Skeleton';
import { ErrorBanner } from '../components/NetworkGuard';
import ErrorView, { ERROR_TYPES } from '../components/ErrorView';

const { width } = Dimensions.get('window');

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
  const [activeTab, setActiveTab] = useState('clients'); // 'clients', 'activity', 'reprints'
  const [currentSlide, setCurrentSlide] = useState(0);

  const isSuperAdmin = user?.role === 'admin' || user?.isSuperAdmin;
  const isOperator = user?.role === 'admin_staff';
  const isClient = user?.role === 'client';
  const isAssistant = user?.role === 'client_staff';

  const loadDashboard = useCallback(async () => {
    const { ok, data } = await apiGet('/api/mobile/dashboard/');
    if (!ok || !data?.success) throw new Error(data?.message || 'Sync failed');
    return data.data;
  }, []);

  const { data: counts = {}, loading, refreshing, error, refresh } = useRefreshableResource(loadDashboard, { initialData: {} });
  const totalCards = counts.total || STATUS_CONFIG.filter(s => s.key !== 'total' && s.key !== 'pool').reduce((sum, s) => sum + (counts[s.key] || 0), 0);
  
  const quickActions = useMemo(() => {
    const actions = [];
    const perms = user?.permissions || {};
    const hasReprintPerm = perms.perm_idcard_reprint_list || perms.perm_reprint_request_list || perms.perm_confirmed_list;

    if (isSuperAdmin) {
      actions.push({ label: 'ADD CLIENT', icon: 'building', color: '#3b82f6', bg: '#eff6ff', screen: 'ClientsList', params: { openForm: true } });
      actions.push({ label: 'ADD ASSISTANT', icon: 'users', color: '#8b5cf6', bg: '#f5f3ff', screen: 'StaffManage', params: { role: 'client_staff', openForm: true } });
      actions.push({ label: 'ADD OPERATOR', icon: 'user-tie', color: '#10b981', bg: '#ecfdf5', screen: 'StaffManage', params: { role: 'admin_staff', openForm: true } });
      actions.push({ label: 'REPRINTS', icon: 'redo', color: '#f97316', bg: '#fff7ed', screen: 'Reprint', params: { clientId: 0 } });
    } else if (isOperator) {
      actions.push({ label: 'ADD CLIENT', icon: 'building', color: '#3b82f6', bg: '#eff6ff', screen: 'ClientsList', params: { openForm: true } });
      actions.push({ label: 'REPRINT', icon: 'redo', color: '#f97316', bg: '#fff7ed', screen: 'Reprint', params: { clientId: 0 } });
    } else if (isClient || isAssistant) {
      actions.push({ label: 'NOTIFICATIONS', icon: 'bell', color: '#f59e0b', bg: '#fffbeb', screen: 'Notifications' });
      if (hasReprintPerm) {
        actions.push({ label: 'REPRINT', icon: 'redo', color: '#f97316', bg: '#fff7ed', screen: 'Reprint', params: { clientId: user?.client_id } });
      }
      if (isClient && perms.perm_manage_client_staff) {
        actions.push({ label: 'ASSISTANT', icon: 'users', color: '#8b5cf6', bg: '#f5f3ff', screen: 'StaffManage' });
      }
    }
    return actions;
  }, [user, isSuperAdmin, isOperator, isClient, isAssistant]);

  if (loading) return (
    <View style={s.root}>
      <LinearGradient colors={gradients.brand} style={[s.header, { paddingTop: insets.top + 12 }]}>
        <Text style={s.headerTitle}>Loading Dashboard...</Text>
      </LinearGradient>
      <DashboardSkeleton />
    </View>
  );

  if (error && !counts.pending && !refreshing) return (
    <View style={s.root}>
      <LinearGradient colors={gradients.brand} style={[s.header, { paddingTop: insets.top + 12 }]}>
        <Text style={s.headerTitle}>Adarsh ID Cards</Text>
      </LinearGradient>
      <ErrorView type={error === 'network' ? ERROR_TYPES.NETWORK : ERROR_TYPES.SERVER} onRetry={refresh} message={error} />
    </View>
  );

  return (
    <View style={s.root}>
      <LinearGradient colors={gradients.brandFull} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={[s.header, { paddingTop: insets.top + 12 }]}>
        <View style={s.headerRow}>
          <TouchableOpacity style={s.headerLeftBtn} onPress={() => navigation.navigate('Landing')} activeOpacity={0.8}>
            <Image source={require('../../assets/logo.png')} style={s.logo} resizeMode="contain" />
          </TouchableOpacity>
          <View style={s.headerCenter}><Text style={s.brandName}>Adarsh ID Cards</Text></View>
          <View style={s.headerRight}>
            <TouchableOpacity style={s.profileBtn} onPress={() => navigation.navigate('Profile')}>
              <IconProfile size={14} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
        <TouchableOpacity style={s.searchBar} activeOpacity={0.8} onPress={() => navigation.navigate('Search')}>
          <IconSearch size={13} color="rgba(255,255,255,0.5)" />
          <Text style={s.searchPlaceholder}>Search cards, names, numbers...</Text>
        </TouchableOpacity>
      </LinearGradient>

      <ScrollView style={s.scroll} contentContainerStyle={s.scrollC} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.brandLight} />}>

        <View style={s.statusGrid}>
          {STATUS_CONFIG.map(st => {
            const val = st.key === 'total' ? totalCards : (counts[st.key] || 0);
            return (
              <TouchableOpacity key={st.key} style={s.statusCardOuter} activeOpacity={0.8}
                onPress={() => {
                  const statusMap = { pending: 'p', verified: 'v', approved: 'a', download: 'd', pool: 'po' };
                  const tableKey = statusMap[st.key] || st.key;
                  const tablesWithStatus = (counts.tables || []).filter(t => (t[tableKey] || 0) > 0);
                  if (st.key === 'total') navigation.navigate('Groups');
                  else if (tablesWithStatus.length === 1) navigation.navigate('CardList', { tableId: tablesWithStatus[0].id, status: st.key });
                  else navigation.navigate('TablePicker', { status: st.key });
                }}>
                <LinearGradient colors={[st.bg, st.bg2]} start={{x:0, y:0}} end={{x:1, y:1}} style={s.statusCard}>
                  <View style={s.statusCardContent}>
                    <View style={s.statusIconCircle}><st.Svg size={16} color="#fff" /></View>
                    <View style={s.statusInfo}>
                      <Text style={s.statusCount}>{val.toLocaleString()}</Text>
                      <Text style={s.statusLabel}>{st.label.toUpperCase()}</Text>
                    </View>
                  </View>
                </LinearGradient>
              </TouchableOpacity>
            );
          })}
        </View>

        {(isSuperAdmin || isOperator) && (
          <View style={s.homeSectionWrap}>
            <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} snapToInterval={width - 24}
              decelerationRate="fast" style={s.slideScroll} onMomentumScrollEnd={(e) => setCurrentSlide(Math.round(e.nativeEvent.contentOffset.x / (width - 24)))}>
              <View style={s.slidePage}>
                <Text style={s.homeSecTitle}>HOME SECTION</Text>
                <View style={s.tabBar}>
                  {['clients', 'activity', 'reprints'].map(tab => (
                    <TouchableOpacity key={tab} style={[s.tabBtn, activeTab === tab && s.tabBtnActive]} onPress={() => setActiveTab(tab)}>
                      <Text style={[s.tabBtnText, activeTab === tab && s.tabBtnTextActive]}>{tab.toUpperCase()} {tab === 'activity' ? '' : 'LIST'}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <View style={s.slidePage}>
                <Text style={s.homeSecTitle}>QUICK ACTIONS</Text>
                <View style={s.quickActionsRow}>
                  {quickActions.slice(0, 3).map((act, i) => (
                    <TouchableOpacity key={i} style={s.quickActionBtn} onPress={() => navigation.navigate(act.screen, act.params)}>
                      <View style={[s.qaIcon, { backgroundColor: act.bg }]}><DynamicIcon name={act.icon} size={14} color={act.color} /></View>
                      <Text style={s.qaLabel}>{act.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </ScrollView>
            <View style={s.dotRow}>
              {[0, 1].map(i => <View key={i} style={[s.dot, currentSlide === i && s.dotActive]} />)}
            </View>
          </View>
        )}

        <View style={s.mainContent}>
          {isSuperAdmin || isOperator ? (
            activeTab === 'clients' ? (
              <View>
                <View style={s.secHeaderRow}>
                  <Text style={s.secTitle}>RECENT CLIENTS</Text>
                  <TouchableOpacity onPress={() => navigation.navigate('ClientsList')}><Text style={s.viewAllLink}>VIEW ALL</Text></TouchableOpacity>
                </View>
                {counts.recent_clients?.length > 0 ? counts.recent_clients.map(client => (
                  <TouchableOpacity key={client.id} style={s.clientCard} onPress={() => navigation.navigate('TablePicker', { clientId: client.id })}>
                    <View style={s.clientHeader}>
                      <View style={[s.clientIcon, { backgroundColor: theme.bgSoft }]}><DynamicIcon name="building" size={14} color={theme.primary} /></View>
                      <View style={s.clientInfo}><Text style={s.clientName}>{client.name}</Text></View>
                    </View>
                  </TouchableOpacity>
                )) : <View style={s.emptyState}><Text style={s.emptyText}>No recent clients</Text></View>}
              </View>
            ) : activeTab === 'activity' ? (
              <View>
                <View style={s.secHeaderRow}><Text style={s.secTitle}>RECENT ACTIVITY</Text></View>
                {counts.recent_activity?.length > 0 ? counts.recent_activity.map(act => (
                  <View key={act.id} style={s.activityCard}>
                    <View style={[s.activityIcon, { backgroundColor: act.bg }]}><DynamicIcon name={act.icon || 'history'} size={12} color={act.color} /></View>
                    <View style={s.activityInfo}><Text style={s.activityText}>{act.text}</Text><Text style={s.activityTime}>{act.time_ago}</Text></View>
                  </View>
                )) : <View style={s.emptyState}><Text style={s.emptyText}>No activity found</Text></View>}
              </View>
            ) : (
              <View>
                <View style={s.secHeaderRow}>
                  <Text style={s.secTitle}>RECENT REPRINTS</Text>
                  <TouchableOpacity onPress={() => navigation.navigate('Reprint')}><Text style={s.viewAllLink}>VIEW ALL</Text></TouchableOpacity>
                </View>
                {counts.recent_reprints?.length > 0 ? counts.recent_reprints.map(rep => (
                  <TouchableOpacity key={rep.id} style={s.reprintCard} onPress={() => navigation.navigate('Reprint', { clientId: 0 })}>
                    <View style={[s.reprintIcon, { backgroundColor: rep.status === 'requested' ? '#fffbeb' : '#ecfdf5' }]}><DynamicIcon name="redo" size={12} color={rep.status === 'requested' ? '#f59e0b' : '#10b981'} /></View>
                    <View style={s.reprintInfo}><Text style={s.reprintTitle}>#{rep.card_id} - {rep.client_name}</Text><Text style={s.reprintSub}>{rep.status.toUpperCase()}</Text></View>
                  </TouchableOpacity>
                )) : <View style={s.emptyState}><Text style={s.emptyText}>No recent reprints</Text></View>}
              </View>
            )
          ) : (
            <>
              <View style={s.secHeaderRow}>
                <Text style={s.secTitle}>MY TABLES</Text>
                <TouchableOpacity onPress={() => navigation.navigate('Groups')}><Text style={s.viewAllLink}>VIEW ALL</Text></TouchableOpacity>
              </View>
              {counts.tables?.length > 0 ? counts.tables.map(table => (
                <TouchableOpacity key={table.id} style={s.tableCard} onPress={() => navigation.navigate('CardList', { tableId: table.id, status: 'all' })}>
                  <View style={s.tableCardTop}>
                    <View style={[s.tableIcon, { backgroundColor: theme.bgSoft }]}><DynamicIcon name="table" size={14} color={theme.primary} /></View>
                    <Text style={s.tableName}>{table.name}</Text>
                  </View>
                  <View style={s.tableStats}>
                    {['P', 'V', 'A', 'D'].map((st, idx) => (
                      <Text key={st} style={[s.statBadge, { backgroundColor: [colors.brandPrimary, '#10b981', '#3b82f6', '#8b5cf6'][idx] }]}>
                        {st}: {table[st.toLowerCase()] || 0}
                      </Text>
                    ))}
                  </View>
                </TouchableOpacity>
              )) : <View style={s.emptyState}><Text style={s.emptyText}>No tables found</Text></View>}
            </>
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {(isSuperAdmin || user?.permissions?.perm_idcard_add) && (
        <TouchableOpacity style={s.fab} onPress={() => navigation.navigate('TablePicker', { action: 'add' })} activeOpacity={0.8}>
          <LinearGradient colors={gradients.brand} style={s.fabGradient}><DynamicIcon name="plus" size={20} color="#fff" /></LinearGradient>
        </TouchableOpacity>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceBg },
  header: { paddingHorizontal: 16, paddingBottom: 20, borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg, ...shadows.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  logo: { width: 32, height: 32 },
  brandName: { color: '#fff', fontSize: 18, fontFamily: fontFamily.bold },
  profileBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.15)', marginTop: 12, paddingHorizontal: 12, height: 44, borderRadius: radius.sm, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  searchPlaceholder: { color: 'rgba(255,255,255,0.6)', fontSize: 13, marginLeft: 10, fontFamily: fontFamily.medium },
  scroll: { flex: 1 },
  scrollC: { padding: 12 },
  statusGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  statusCardOuter: { width: (width - 44) / 3, aspectRatio: 1, borderRadius: radius.xs, overflow: 'hidden', ...shadows.sm },
  statusCard: { flex: 1, padding: 8, justifyContent: 'center' },
  statusCardContent: { alignItems: 'center' },
  statusIconCircle: { width: 28, height: 28, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  statusCount: { color: '#fff', fontSize: 16, fontFamily: fontFamily.bold },
  statusLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 7, fontFamily: fontFamily.bold, letterSpacing: 0.5 },
  homeSectionWrap: { marginTop: 16 },
  slideScroll: { width: width - 24 },
  slidePage: { width: width - 24, paddingRight: 4 },
  homeSecTitle: { fontSize: 10, fontFamily: fontFamily.bold, color: colors.gray400, letterSpacing: 1, marginBottom: 10 },
  tabBar: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: radius.sm, padding: 4, ...shadows.sm, borderWidth: 1, borderColor: colors.gray100 },
  tabBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: radius.xs },
  tabBtnActive: { backgroundColor: colors.brandPrimary },
  tabBtnText: { fontSize: 8, fontFamily: fontFamily.bold, color: colors.gray400 },
  tabBtnTextActive: { color: '#fff' },
  quickActionsRow: { flexDirection: 'row', gap: 10 },
  quickActionBtn: { flex: 1, backgroundColor: '#fff', padding: 10, borderRadius: radius.sm, alignItems: 'center', ...shadows.sm, borderWidth: 1, borderColor: colors.gray100 },
  qaIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  qaLabel: { fontSize: 7, fontFamily: fontFamily.bold, color: colors.gray700 },
  dotRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 12, gap: 6 },
  dot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.gray200 },
  dotActive: { width: 12, backgroundColor: colors.brandPrimary },
  mainContent: { marginTop: 10 },
  secHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, marginTop: 10 },
  secTitle: { fontSize: 10, fontFamily: fontFamily.bold, color: colors.gray400, letterSpacing: 1 },
  viewAllLink: { fontSize: 9, fontFamily: fontFamily.bold, color: colors.brandPrimary },
  clientCard: { backgroundColor: '#fff', borderRadius: radius.sm, padding: 10, ...shadows.sm, borderWidth: 1, borderColor: colors.gray100, marginBottom: 8 },
  clientHeader: { flexDirection: 'row', alignItems: 'center' },
  clientIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  clientName: { fontSize: 13, fontFamily: fontFamily.bold, color: colors.gray800 },
  activityCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', padding: 10, borderRadius: radius.sm, marginBottom: 8, ...shadows.sm, borderWidth: 1, borderColor: colors.gray100 },
  activityIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  activityText: { fontSize: 11, fontFamily: fontFamily.medium, color: colors.gray800 },
  activityTime: { fontSize: 9, fontFamily: fontFamily.bold, color: colors.gray400, marginTop: 2 },
  reprintCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', padding: 10, borderRadius: radius.sm, marginBottom: 8, ...shadows.sm, borderWidth: 1, borderColor: colors.gray100 },
  reprintIcon: { width: 28, height: 28, borderRadius: 6, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  reprintTitle: { fontSize: 12, fontFamily: fontFamily.bold, color: colors.gray800 },
  reprintSub: { fontSize: 9, fontFamily: fontFamily.medium, color: colors.gray500 },
  tableCard: { backgroundColor: '#fff', borderRadius: radius.sm, padding: 12, ...shadows.sm, borderWidth: 1, borderColor: colors.gray100, marginBottom: 12 },
  tableCardTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  tableIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  tableName: { fontSize: 14, fontFamily: fontFamily.bold, color: colors.gray800 },
  tableStats: { flexDirection: 'row', justifyContent: 'space-between' },
  statBadge: { fontSize: 9, fontFamily: fontFamily.bold, color: '#fff', paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.xs },
  fab: { position: 'absolute', bottom: 30, right: 20, width: 56, height: 56, borderRadius: 28, ...shadows.xl },
  fabGradient: { width: '100%', height: '100%', borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  emptyState: { padding: 30, alignItems: 'center' },
  emptyText: { color: colors.gray400, fontSize: 12, fontFamily: fontFamily.medium },
});
