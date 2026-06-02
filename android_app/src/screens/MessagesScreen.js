import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl, TouchableOpacity, LayoutAnimation } from 'react-native';
import { DynamicIcon } from '../components/Icons';
import TopBar from '../components/TopBar';
import { ErrorBanner } from '../components/NetworkGuard';
import { apiGet } from '../api/client';
import { colors, typography, spacing, radius, shadows, fontFamily } from '../theme';
import useRefreshableResource from '../hooks/useRefreshableResource';
import { NotificationsSkeleton } from '../components/Skeleton';

export default function MessagesScreen({ navigation }) {
  const [expandedIds, setExpandedIds] = useState(new Set());

  const loadMessages = useCallback(async () => {
    const { ok, data } = await apiGet('/api/mobile/messages/');
    if (!ok || !data?.success) {
      throw new Error(data?.message || 'Failed to load messages');
    }
    return data.data || [];
  }, []);

  const { data: messages = [], loading, refreshing, error, refresh } = useRefreshableResource(loadMessages, { initialData: [] });

  const toggleExpand = (id) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const getInitialsColor = (name) => {
    const hash = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const hues = [210, 260, 280, 320, 15, 140]; // Premium color range hues
    const hue = hues[hash % hues.length];
    return `hsl(${hue}, 85%, 94%)`;
  };

  const getInitialsTextColor = (name) => {
    const hash = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const hues = [210, 260, 280, 320, 15, 140];
    const hue = hues[hash % hues.length];
    return `hsl(${hue}, 80%, 40%)`;
  };

  const renderItem = ({ item }) => {
    const sender = item.sent_by_name || 'Admin';
    const isExpanded = expandedIds.has(item.id);
    const initials = sender.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
    const avatarBg = getInitialsColor(sender);
    const avatarColor = getInitialsTextColor(sender);

    return (
      <TouchableOpacity 
        style={[s.card, !item.read && s.unread]} 
        activeOpacity={0.9} 
        onPress={() => toggleExpand(item.id)}
      >
        <View style={s.row}>
          <View style={[s.avatar, { backgroundColor: avatarBg }]}>
            <Text style={[s.avatarTxt, { color: avatarColor }]}>{initials}</Text>
          </View>
          
          <View style={s.body}>
            <View style={s.headerRow}>
              <View style={s.senderCol}>
                <Text style={s.senderLabel}>SENDER</Text>
                <Text style={s.senderName} numberOfLines={1}>{sender}</Text>
              </View>
              <View style={s.badgeRow}>
                {item.scope === 'client_and_staff' ? (
                  <View style={[s.scopeBadge, s.badgeClientStaff]}>
                    <Text style={s.scopeText}>Client + Staff</Text>
                  </View>
                ) : (
                  <View style={[s.scopeBadge, s.badgeClientOnly]}>
                    <Text style={s.scopeText}>Client Only</Text>
                  </View>
                )}
                {!item.read && <View style={s.unreadDot} />}
              </View>
            </View>

            <Text 
              style={[s.msg, !isExpanded && s.msgCollapsed]} 
              numberOfLines={isExpanded ? undefined : 3}
            >
              {item.message}
            </Text>

            <View style={s.footer}>
              <View style={s.timeRow}>
                <DynamicIcon name="clock" size={10} color={colors.gray400} />
                <Text style={s.time}>{item.created_at}</Text>
              </View>
              {item.message && item.message.length > 120 && (
                <Text style={s.expandTxt}>
                  {isExpanded ? 'Show less' : 'Read more...'}
                </Text>
              )}
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const EmptyState = () => (
    <View style={s.empty}>
      <View style={s.emptyIcon}>
        <DynamicIcon name="envelope-open" size={26} color={colors.gray300} />
      </View>
      <Text style={s.emptyTitle}>No messages yet</Text>
      <Text style={s.emptySub}>Direct messages from Adarsh Admin will appear here.</Text>
    </View>
  );

  return (
    <View style={s.root}>
      <TopBar title="Official Messages" subtitle="One-way admin messages & instructions" onBack={() => navigation.goBack()} />
      {error && <ErrorBanner message={error} onDismiss={() => refresh()} onRetry={() => refresh()} />}
      {loading ? (
        <NotificationsSkeleton />
      ) : (
        <FlatList
          data={messages}
          renderItem={renderItem}
          keyExtractor={(item, i) => item.id?.toString() || i.toString()}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.brandLight} />}
          ListEmptyComponent={EmptyState}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceBg },
  list: { padding: 16, paddingBottom: 32, gap: 12 },
  card: { backgroundColor: '#fff', borderRadius: radius.sm, padding: 14, borderWidth: 1, borderColor: '#e2e8f0', ...shadows.sm },
  unread: { borderLeftWidth: 3, borderLeftColor: '#f59e0b', borderColor: '#e2e8f0' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(0,0,0,0.03)' },
  avatarTxt: { fontSize: 13, fontFamily: 'SairaSemiCondensed-Bold' },
  body: { flex: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8, gap: 8 },
  senderCol: { flex: 1 },
  senderLabel: { fontSize: 8, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray400, letterSpacing: 0.5 },
  senderName: { fontSize: 13, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray800, marginTop: 1 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  unreadDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#f59e0b' },
  scopeBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.xs, borderWidth: 1 },
  badgeClientOnly: { backgroundColor: '#eff6ff', borderColor: '#bfdbfe' },
  badgeClientStaff: { backgroundColor: '#f5f3ff', borderColor: '#ddd6fe' },
  scopeText: { fontSize: 8, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray500 },
  msg: { fontSize: 12, color: colors.gray600, fontFamily: 'SairaSemiCondensed-Medium', lineHeight: 18, marginVertical: 4 },
  msgCollapsed: { opacity: 0.9 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, borderTopWidth: 1, borderTopColor: '#f8fafc', paddingTop: 8 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  time: { fontSize: 10, color: colors.gray400, fontFamily: 'SairaSemiCondensed-Regular' },
  expandTxt: { fontSize: 10, color: colors.brandPrimary, fontFamily: 'SairaSemiCondensed-Bold' },
  empty: { alignItems: 'center', justifyContent: 'center', paddingTop: 100 },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#f8fafc', alignItems: 'center', justifyContent: 'center', marginBottom: 16, borderWidth: 1, borderColor: '#e2e8f0' },
  emptyTitle: { fontSize: 14, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray500 },
  emptySub: { fontSize: 11, color: colors.gray400, marginTop: 6, fontFamily: 'SairaSemiCondensed-Medium', textAlign: 'center', paddingHorizontal: 32 },
});
