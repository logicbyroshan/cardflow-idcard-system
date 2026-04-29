import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, Dimensions, Image } from 'react-native';

const { width } = Dimensions.get('window');
import { FontAwesome5 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiGet } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { DashboardSkeleton } from '../components/Skeleton';
import { ErrorView, ErrorBanner, ERROR_TYPES } from '../components/NetworkGuard';
import StatusBadge from '../components/StatusBadge';
import { colors, gradients, shadows, radius, roleThemes } from '../theme';

const STATUS_CONFIG = [
  { key: 'pending',  label: 'Pending',  icon: 'clock',        bg: colors.pending.bg,  text: colors.pending.text,  border: colors.pending.border },
  { key: 'verified', label: 'Verified', icon: 'check-circle', bg: colors.verified.bg, text: colors.verified.text, border: colors.verified.border },
  { key: 'approved', label: 'Approved', icon: 'user-check',   bg: colors.approved.bg, text: colors.approved.text, border: colors.approved.border },
  { key: 'download', label: 'Download', icon: 'download',     bg: colors.download.bg, text: colors.download.text, border: colors.download.border },
  { key: 'pool',     label: 'Pool',     icon: 'layer-group',  bg: colors.pool.bg,     text: colors.pool.text,     border: colors.pool.border },
  { key: 'total',    label: 'Total',    icon: 'id-card',      bg: colors.indigo50,    text: colors.brandPrimary,  border: colors.indigo200 },
];

export default function HomeScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { showToast } = useToast();

  const loadDashboard = useCallback(async (isSilent = false) => {
    try {
      if (!isSilent) setError(null);
      const { data } = await apiGet('/app/api/dashboard/');
      if (data?.success) setCounts(data.data || {});
      else {
        if (isSilent) showToast('Failed to load dashboard data');
        else setError('Failed to load dashboard data');
      }
    } catch (e) {
      const msg = e.message?.includes('Network') ? 'Network connection lost' : 'Server is temporarily unavailable';
      if (isSilent) showToast(msg);
      else setError(e.message?.includes('Network') ? 'network' : 'server');
    }
  }, [showToast]);

  useEffect(() => { (async () => { await loadDashboard(); setLoading(false); })(); }, []);

  const onRefresh = useCallback(async () => { setRefreshing(true); await loadDashboard(true); setRefreshing(false); }, [loadDashboard]);

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
          <View style={s.headerLeft}>
            <View style={s.avatarContainer}>
              {user?.profile_image ? (
                <Image source={{ uri: user.profile_image }} style={s.avatar} />
              ) : (
                <View style={[s.avatar, s.avatarPlaceholder]}>
                  <FontAwesome5 name="user" size={14} color="rgba(255,255,255,0.6)" />
                </View>
              )}
            </View>
            <View>
              <Text style={s.greeting}>Welcome back,</Text>
              <Text style={s.headerTitle}>{user?.name || 'User'}</Text>
            </View>
          </View>
          <View style={s.headerBtns}>
            <TouchableOpacity onPress={() => navigation.navigate('Notifications')} style={s.headerBtn}><FontAwesome5 name="bell" size={16} color="#fff" solid /></TouchableOpacity>
            <TouchableOpacity onPress={() => navigation.navigate('Settings')} style={s.headerBtn}><FontAwesome5 name="cog" size={16} color="#fff" solid /></TouchableOpacity>
          </View>
        </View>
        <TouchableOpacity 
          style={s.searchBar} 
          activeOpacity={0.8}
          onPress={() => navigation.navigate('Search')}
        >
          <FontAwesome5 name="search" size={14} color="rgba(255,255,255,0.6)" />
          <Text style={s.searchPlaceholder}>Search for cards, names, numbers...</Text>
        </TouchableOpacity>
      </LinearGradient>

      <ScrollView 
        style={s.scroll} 
        contentContainerStyle={s.scrollC} 
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadDashboard(true)} tintColor={colors.brandPrimary} />}
      >
        <View style={s.hero} />

        <View style={s.statusGrid}>
          {STATUS_CONFIG.map(st => {
            const countValue = st.key === 'total' ? totalCards : (counts[st.key] || 0);
            return (
              <TouchableOpacity key={st.key} style={[s.statusCard, { borderColor: st.border }]} activeOpacity={0.7}
                onPress={() => navigation.navigate('TablePicker', { status: st.key })}>
                <View style={[s.statusIcon, { backgroundColor: st.bg }]}>
                  <FontAwesome5 name={st.icon} size={16} color={st.text} solid />
                </View>
                <Text style={[s.statusCount, { color: st.text }]}>{countValue.toLocaleString()}</Text>
                <Text style={s.statusLabel}>{st.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={s.secHeaderBar}>
          <View style={s.secHeaderInner}>
            <Text style={s.secTitle}>MY GROUPS/TABLES</Text>
            <TouchableOpacity onPress={() => navigation.navigate('Tables')} style={s.viewAllBadge}>
              <Text style={s.secAction}>VIEW ALL</Text>
              <FontAwesome5 name="chevron-right" size={8} color={theme.primary} style={{ marginLeft: 4 }} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={s.tablesContainer}>
          {counts.tables && counts.tables.length > 0 ? (
            counts.tables.map(table => (
              <View key={table.id} style={s.tableCard}>
                <View style={s.tableHeader}>
                  <View style={[s.tableIconMain, { backgroundColor: theme.bgSoft }]}>
                    <FontAwesome5 name="table" size={16} color={theme.primary} />
                  </View>
                  <Text style={s.tableListItemName}>{table.name}</Text>
                </View>
                <View style={s.tableActionsRow}>
                  {[
                    { key: 'p', status: 'pending' },
                    { key: 'v', status: 'verified' },
                    { key: 'a', status: 'approved' },
                    { key: 'd', status: 'download' },
                    { key: 'po', status: 'pool' },
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
          
        </View>

      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceBg },
  scroll: { flex: 1 }, 
  scrollC: { paddingBottom: 40 },
  
  // Header
  header: { paddingHorizontal: 20, paddingBottom: 16, ...shadows.lg },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatarContainer: { width: 44, height: 44, borderRadius: radius.sm, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.3)', padding: 2 },
  avatar: { width: '100%', height: '100%', borderRadius: radius.sm - 2 },
  avatarPlaceholder: { backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  greeting: { fontSize: 12, color: 'rgba(255,255,255,0.7)', fontFamily: 'SairaSemiCondensed-Medium' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#fff', fontFamily: 'SairaSemiCondensed-Bold', marginTop: -2 },
  headerBtns: { flexDirection: 'row', gap: 10 },
  headerBtn: { width: 40, height: 40, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 16, paddingVertical: 12, borderRadius: radius.md, gap: 12 },
  searchPlaceholder: { color: 'rgba(255,255,255,0.6)', fontSize: 13, fontFamily: 'SairaSemiCondensed-Regular' },

  // Hero Section
  hero: { paddingTop: 10 },
  
  totalLabel: { fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.7)', letterSpacing: 1.5, fontFamily: 'SairaSemiCondensed-Bold' },
  totalValue: { fontSize: 36, fontWeight: '900', color: '#fff', marginTop: 4, fontFamily: 'SairaSemiCondensed-Bold' },
  totalIconW: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },

  // Status Grid (3x2)
  statusGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 20, marginTop: -10 },
  statusCard: { width: (width - 56) / 3, backgroundColor: '#fff', borderRadius: radius.md, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: '#f1f5f9', ...shadows.sm },
  statusIcon: { width: 40, height: 40, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  statusCount: { fontSize: 18, fontWeight: '800', fontFamily: 'SairaSemiCondensed-Bold' },
  statusLabel: { fontSize: 10, fontWeight: '600', color: colors.gray500, marginTop: 2, fontFamily: 'SairaSemiCondensed-Medium', textAlign: 'center' },

  // Sections
  secHeaderBar: { paddingHorizontal: 20, marginTop: 24, marginBottom: 12 },
  secHeaderInner: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between', 
    backgroundColor: '#fff', 
    paddingHorizontal: 16, 
    paddingVertical: 12, 
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    ...shadows.sm
  },
  secTitle: { fontSize: 13, fontWeight: '800', color: colors.gray800, letterSpacing: 0.5, fontFamily: 'SairaSemiCondensed-Bold' },
  viewAllBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceBg, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.xs },
  secAction: { fontSize: 10, fontWeight: '800', color: colors.brandPrimary, fontFamily: 'SairaSemiCondensed-Bold' },

  // Tables
  tablesContainer: { paddingHorizontal: 20, gap: 12 },
  tableCard: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 10, borderWidth: 1, borderColor: '#f1f5f9', ...shadows.sm },
  tableHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  tableIconMain: { width: 40, height: 40, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  tableListItemName: { fontSize: 15, fontWeight: '700', color: colors.gray800, fontFamily: 'SairaSemiCondensed-Bold' },
  tableActionsRow: { flexDirection: 'row', gap: 4 },
  statusPillBtn: { flex: 1 },
  
  emptyTables: { padding: 40, alignItems: 'center' },
  emptyTablesText: { color: colors.gray400, fontSize: 14, fontFamily: 'SairaSemiCondensed-Regular' },
});
