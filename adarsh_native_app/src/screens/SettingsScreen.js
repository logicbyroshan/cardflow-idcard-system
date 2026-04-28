import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import TopBar from '../components/TopBar';
import { SettingsSkeleton } from '../components/Skeleton';
import { apiGet } from '../api/client';
import { colors, shadows } from '../theme';

export default function SettingsScreen({ navigation }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { data: resp } = await apiGet('/app/api/settings/');
        if (resp?.success) setData(resp.data);
      } catch (e) { /* silent */ }
      setLoading(false);
    })();
  }, []);

  if (loading) return (
    <View style={s.root}><TopBar title="Settings" onBack={() => navigation.goBack()} /><SettingsSkeleton /></View>
  );

  const d = data || {};

  return (
    <View style={s.root}>
      <TopBar title="Settings" subtitle="System information & stats" onBack={() => navigation.goBack()} />
      <ScrollView style={s.scroll} contentContainerStyle={s.scrollC} showsVerticalScrollIndicator={false}>

        {/* Stats */}
        <Text style={s.secTitle}>CLIENT STATS</Text>
        <View style={s.statsGrid}>
          <StatBox icon="table" color="#667eea" bg="rgba(102,126,234,0.08)" label="Tables" value={d.table_count ?? '-'} />
          <StatBox icon="layer-group" color="#8b5cf6" bg="#ede9fe" label="Groups" value={d.group_count ?? '-'} />
          <StatBox icon="id-card" color="#f59e0b" bg="#fef3c7" label="Cards" value={d.total_cards ?? '-'} />
        </View>

        {d.admin_client_count !== undefined && (
          <>
            <Text style={s.secTitle}>ADMIN STATS</Text>
            <View style={s.statsGrid}>
              <StatBox icon="building" color="#3b82f6" bg="#dbeafe" label="Clients" value={d.admin_client_count ?? '-'} />
              <StatBox icon="users" color="#10b981" bg="#d1fae5" label="Staff" value={d.admin_staff_count ?? '-'} />
              <StatBox icon="id-card" color="#ec4899" bg="#fce7f3" label="All Cards" value={d.admin_total_cards ?? '-'} />
            </View>
          </>
        )}

        {/* Recent Activity Log */}
        {d.log_activities && d.log_activities.length > 0 && (
          <>
            <Text style={s.secTitle}>RECENT ACTIVITY</Text>
            <View style={s.logsCard}>
              {d.log_activities.slice(0, 15).map((log, i) => (
                <View key={i} style={s.logRow}>
                  <View style={s.logDot} />
                  <View style={s.logInfo}>
                    <Text style={s.logName} numberOfLines={1}>{log.name}</Text>
                    <Text style={s.logMeta}>{log.table_name} · {log.status_display} · {log.updated_at}</Text>
                  </View>
                  <StatusPill status={log.status} />
                </View>
              ))}
            </View>
          </>
        )}

        {/* System Info */}
        <Text style={s.secTitle}>SYSTEM INFO</Text>
        <View style={s.sysCard}>
          <InfoRow label="App Version" value={d.app_version || '-'} />
          <InfoRow label="Django Version" value={d.django_version || '-'} />
          <InfoRow label="Python Version" value={d.python_version || '-'} />
          <InfoRow label="Debug Mode" value={d.debug_mode ? 'Enabled' : 'Disabled'} valueColor={d.debug_mode ? '#f59e0b' : '#22c55e'} />
        </View>
      </ScrollView>
    </View>
  );
}

function StatBox({ icon, color, bg, label, value }) {
  return (
    <View style={s.statBox}>
      <View style={[s.statIcon, { backgroundColor: bg }]}><FontAwesome5 name={icon} size={14} color={color} solid /></View>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

function StatusPill({ status }) {
  const MAP = { pending: { bg: '#fef3c7', c: '#b45309' }, verified: { bg: '#d1fae5', c: '#047857' }, approved: { bg: '#e0f2fe', c: '#0369a1' }, download: { bg: '#ede9fe', c: '#7c3aed' }, pool: { bg: '#fce7f3', c: '#be185d' } };
  const st = MAP[status] || { bg: '#f3f4f6', c: '#6b7280' };
  return (<View style={[s.pill, { backgroundColor: st.bg }]}><Text style={[s.pillText, { color: st.c }]}>{(status || '').charAt(0).toUpperCase() + (status || '').slice(1)}</Text></View>);
}

function InfoRow({ label, value, valueColor }) {
  return (
    <View style={s.infoRow}>
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={[s.infoValue, valueColor && { color: valueColor }]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceBg },
  loadWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { flex: 1 }, scrollC: { paddingBottom: 40 },
  secTitle: { fontSize: 10, fontWeight: '700', color: colors.gray400, letterSpacing: 1.2, marginHorizontal: 20, marginTop: 16, marginBottom: 8 },
  statsGrid: { flexDirection: 'row', gap: 8, marginHorizontal: 16 },
  statBox: { flex: 1, backgroundColor: '#fff', borderRadius: 16, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: '#e2e8f0', ...shadows.sm },
  statIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  statValue: { fontSize: 18, fontWeight: '800', color: colors.gray800 },
  statLabel: { fontSize: 10, fontWeight: '600', color: colors.gray400, marginTop: 2 },
  logsCard: { marginHorizontal: 16, backgroundColor: '#fff', borderRadius: 20, borderWidth: 1, borderColor: '#e2e8f0', overflow: 'hidden', ...shadows.sm },
  logRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f9fafb' },
  logDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.brandLight },
  logInfo: { flex: 1, minWidth: 0 },
  logName: { fontSize: 12, fontWeight: '600', color: colors.gray800 },
  logMeta: { fontSize: 10, color: colors.gray400, marginTop: 1 },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  pillText: { fontSize: 9, fontWeight: '700' },
  sysCard: { marginHorizontal: 16, backgroundColor: '#fff', borderRadius: 20, borderWidth: 1, borderColor: '#e2e8f0', overflow: 'hidden', ...shadows.sm },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f9fafb' },
  infoLabel: { fontSize: 12, fontWeight: '500', color: colors.gray500 },
  infoValue: { fontSize: 12, fontWeight: '600', color: colors.gray800 },
});
