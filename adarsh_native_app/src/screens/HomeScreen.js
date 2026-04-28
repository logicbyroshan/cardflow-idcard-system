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

  const totalCards = useMemo(() => STATUS_CONFIG.reduce((sum, s) => sum + (counts[s.key] || 0), 0), [counts]);

  if (loading) return (
    <View style={s.root}>
      <LinearGradient colors={gradients.brand} style={[s.header, { paddingTop: insets.top + 12 }]}>
        <Text style={s.headerTitle}>Adarsh ID Cards</Text>
      </LinearGradient>
      <DashboardSkeleton />
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
        {/* Total Cards Summary */}
        <View style={s.summaryCard}>
          <FontAwesome5 name="id-card" size={16} color="#fff" solid />
          <View style={s.summaryInfo}>
            <Text style={s.summaryCount}>{totalCards.toLocaleString()}</Text>
            <Text style={s.summaryLabel}>Total Cards</Text>
          </View>
        </View>
      </LinearGradient>

      <ScrollView style={s.scroll} contentContainerStyle={s.scrollC} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandLight} />}>

        {/* Status Cards Grid */}
        <Text style={s.secTitle}>CARD STATUS</Text>
        <View style={s.statusGrid}>
          {STATUS_CONFIG.map(st => (
            <TouchableOpacity key={st.key} style={[s.statusCard, { borderColor: st.border }]} activeOpacity={0.7}
              onPress={() => navigation.navigate('TablePicker', { status: st.key })}>
              <View style={[s.statusIcon, { backgroundColor: st.bg }]}>
                <FontAwesome5 name={st.icon} size={14} color={st.text} solid />
              </View>
              <Text style={[s.statusCount, { color: st.text }]}>{(counts[st.key] || 0).toLocaleString()}</Text>
              <Text style={s.statusLabel}>{st.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Quick Actions */}
        <Text style={s.secTitle}>QUICK ACTIONS</Text>
        <View style={s.quickGrid}>
          {[
            { icon: 'search', c: '#3b82f6', bg: '#dbeafe', label: 'Search', screen: 'Search' },
            { icon: 'layer-group', c: '#8b5cf6', bg: '#ede9fe', label: 'Groups', screen: 'Groups' },
            { icon: 'users', c: '#6366f1', bg: '#eef2ff', label: 'Staff', screen: 'StaffManage' },
            { icon: 'building', c: '#0ea5e9', bg: '#e0f2fe', label: 'Clients', screen: 'ClientsList' },
            { icon: 'cog', c: '#6b7280', bg: '#f3f4f6', label: 'Settings', screen: 'Settings' },
            { icon: 'user', c: '#10b981', bg: '#d1fae5', label: 'Profile', screen: 'Profile' },
          ].map(q => (
            <TouchableOpacity key={q.screen} style={s.quickBtn} activeOpacity={0.7} onPress={() => navigation.navigate(q.screen)}>
              <View style={[s.quickIcon, { backgroundColor: q.bg }]}><FontAwesome5 name={q.icon} size={14} color={q.c} solid /></View>
              <Text style={s.quickLabel}>{q.label}</Text>
            </TouchableOpacity>
          ))}
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
  summaryCard: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  summaryInfo: { flex: 1 },
  summaryCount: { fontSize: 22, fontWeight: '800', color: '#fff' },
  summaryLabel: { fontSize: 11, color: 'rgba(255,255,255,0.7)', marginTop: 1 },
  scroll: { flex: 1 }, scrollC: { paddingBottom: 40 },
  secTitle: { fontSize: 10, fontWeight: '700', color: colors.gray400, letterSpacing: 1.2, marginHorizontal: 20, marginTop: 16, marginBottom: 8 },
  // Status Grid
  statusGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 16 },
  statusCard: { width: '31%', backgroundColor: '#fff', borderRadius: 16, padding: 12, alignItems: 'center', borderWidth: 1.5, ...shadows.sm },
  statusIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  statusCount: { fontSize: 20, fontWeight: '800' },
  statusLabel: { fontSize: 10, fontWeight: '600', color: colors.gray400, marginTop: 2 },
  // Quick Actions
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 16 },
  quickBtn: { width: '31%', backgroundColor: '#fff', borderRadius: 16, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: '#e2e8f0', ...shadows.sm },
  quickIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  quickLabel: { fontSize: 11, fontWeight: '600', color: colors.gray700 },
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
