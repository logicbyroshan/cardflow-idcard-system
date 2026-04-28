import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import TopBar from '../components/TopBar';
import { ErrorBanner } from '../components/NetworkGuard';
import { apiGet } from '../api/client';
import { colors, typography, spacing, radius, shadows } from '../theme';

const ICON_MAP = { green: { bg: '#dcfce7', c: '#22c55e' }, blue: { bg: '#dbeafe', c: '#3b82f6' }, purple: { bg: '#ede9fe', c: '#8b5cf6' }, yellow: { bg: '#fef3c7', c: '#f59e0b' }, red: { bg: '#fef2f2', c: '#ef4444' }, orange: { bg: '#ffedd5', c: '#f97316' } };

export default function NotificationsScreen({ navigation }) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const loadNotifications = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const { ok, data } = await apiGet('/app/api/notifications/');
      if (ok && data?.success) setNotifications(data.data || []);
      else setError(data?.message || 'Failed to load notifications');
    } catch (e) {
      setError('Network error - check your connection');
    }
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => { loadNotifications(); }, []);

  const renderItem = ({ item }) => {
    const ic = ICON_MAP[item.color] || { bg: '#f3f4f6', c: '#9ca3af' };
    return (
      <View style={[s.card, !item.read && s.unread]}>
        <View style={s.row}>
          <View style={[s.iconW, { backgroundColor: ic.bg }]}>
            <FontAwesome5 name={item.icon?.replace('fa-', '') || 'bell'} size={14} color={ic.c} solid />
          </View>
          <View style={s.body}>
            <View style={s.titleRow}>
              <Text style={s.title} numberOfLines={1}>{item.title}</Text>
              {!item.read && <View style={s.dot} />}
            </View>
            <Text style={s.msg} numberOfLines={2}>{item.message}</Text>
            <Text style={s.time}>{item.time}</Text>
          </View>
        </View>
      </View>
    );
  };

  const EmptyState = () => (
    <View style={s.empty}>
      <View style={s.emptyIcon}><FontAwesome5 name="bell-slash" size={24} color={colors.gray300} solid /></View>
      <Text style={s.emptyTitle}>No notifications yet</Text>
      <Text style={s.emptySub}>You're all caught up!</Text>
    </View>
  );

  return (
    <View style={s.root}>
      <TopBar title="Notifications" subtitle="Activity & updates" onBack={() => navigation.goBack()} />
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} onRetry={() => loadNotifications(true)} />}
      {loading ? (
        <View style={s.loadingWrap}><ActivityIndicator size="large" color={colors.brandLight} /></View>
      ) : (
        <FlatList
          data={notifications}
          renderItem={renderItem}
          keyExtractor={(item, i) => item.id?.toString() || i.toString()}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadNotifications(true)} tintColor={colors.brandLight} />}
          ListEmptyComponent={EmptyState}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceBg },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16, gap: 10, paddingBottom: 32 },
  card: { backgroundColor: '#fff', borderRadius: 20, padding: 16, borderWidth: 1, borderColor: '#f1f5f9', ...shadows.sm },
  unread: { borderLeftWidth: 4, borderLeftColor: colors.brandLight, borderColor: 'rgba(51,183,239,0.3)' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  iconW: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  title: { fontSize: 13, fontWeight: '700', color: colors.gray800, flex: 1 },
  dot: { width: 8, height: 8, borderRadius: 2, backgroundColor: colors.brandLight, marginTop: 4, marginLeft: 8 },
  msg: { fontSize: 11, color: colors.gray500, marginTop: 4, lineHeight: 16 },
  time: { fontSize: 10, color: colors.gray400, marginTop: 6 },
  empty: { alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyIcon: { width: 64, height: 64, borderRadius: 20, backgroundColor: colors.gray100, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: 13, fontWeight: '600', color: colors.gray400 },
  emptySub: { fontSize: 11, color: colors.gray300, marginTop: 4 },
});
