import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, Dimensions, Image, Modal, ActivityIndicator, TextInput,
  LayoutAnimation, Platform, UIManager
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Camera } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  IconSearch, IconProfile, IconPending, IconVerified, IconApproved,
  IconDownload, IconPool, IconTotal, DynamicIcon, IconClose
} from '../components/Icons';
import { colors, gradients, shadows, radius, fontFamily, roleThemes } from '../theme';
import { useAuth } from '../context/AuthContext';
import useRefreshableResource from '../hooks/useRefreshableResource';
import { apiGet, apiPost } from '../api/client';
import Toast from '../components/Toast';
import { DashboardSkeleton } from '../components/Skeleton';
import { ErrorBanner, ErrorView, ERROR_TYPES } from '../components/NetworkGuard';

const { width } = Dimensions.get('window');

const STATUS_CONFIG = [
  { key: 'pending',  label: 'Pending',   Svg: IconPending,   bg: '#f59e0b', bg2: '#d97706' },
  { key: 'verified', label: 'Verified',  Svg: IconVerified,  bg: '#10b981', bg2: '#059669' },
  { key: 'approved', label: 'Approved',  Svg: IconApproved,  bg: '#3b82f6', bg2: '#2563eb' },
  { key: 'download', label: 'Download',  Svg: IconDownload,  bg: '#8b5cf6', bg2: '#7c3aed' },
  { key: 'pool',     label: 'Pool',      Svg: IconPool,      bg: '#ef4444', bg2: '#b91c1c' },
  { key: 'total',    label: 'All Cards', Svg: IconTotal,     bg: '#1e293b', bg2: '#0f172a' },
];



function ClientMiniStat({ label, count, color, bg, onPress }) {
  return (
    <TouchableOpacity 
      style={s.clientMiniStat} 
      onPress={onPress} 
      activeOpacity={onPress ? 0.6 : 1}
      disabled={!onPress || count === 0}
    >
      <Text style={[s.clientMiniStatLabel, { color, opacity: count > 0 ? 1 : 0.4 }]}>{label}</Text>
      <View style={[s.clientMiniStatBadge, { backgroundColor: bg, opacity: count > 0 ? 1 : 0.3 }]}>
        <Text style={[s.clientMiniStatCount, { color }]}>{count || 0}</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function HomeScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const theme = roleThemes[user?.role] || roleThemes.default;
  const [activeTab, setActiveTab] = useState('clients'); // 'clients', 'activity', 'reprints'
  const [currentSlide, setCurrentSlide] = useState(0);

  useEffect(() => {
    if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      if (status !== 'granted') console.log('Camera permission denied');
    })();
  }, []);

  const isSuperAdmin = user?.role === 'admin' || user?.isSuperAdmin;
  const isOperator = user?.role === 'admin_staff';
  const isClient = user?.role === 'client';
  const isAssistant = user?.role === 'client_staff';

  const loadDashboard = useCallback(async () => {
    try {
      const { ok, data } = await apiGet('/api/mobile/dashboard/');
      if (!ok || !data?.success) throw new Error(data?.message || 'Sync failed');
      return data.data;
    } catch (e) {
      throw e;
    }
  }, []);

  const { data: counts = {}, loading, refreshing, error, refresh } = useRefreshableResource(loadDashboard, { initialData: {} });
  
  // Creation States
  const [showClientForm, setShowClientForm] = useState(false);
  const [showStaffForm, setShowStaffForm] = useState(false);
  const [staffRole, setStaffRole] = useState('client_staff');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });
  const [expandedClient, setExpandedClient] = useState(null); // { id, status }

  const [clientForm, setClientForm] = useState({ name: '', email: '', phone: '', password: '' });
  const [staffForm, setStaffForm] = useState({ first_name: '', last_name: '', email: '', phone: '', password: '' });

  const showToast = (msg, type = 'info') => setToast({ visible: true, message: msg, type });

  const handleSaveClient = async () => {
    if (!clientForm.name || !clientForm.email || !clientForm.password) {
      showToast('Please fill required fields', 'error'); return;
    }
    setSaving(true);
    try {
      const { ok, data } = await apiPost('/api/mobile/client/create/', clientForm);
      if (ok && data.success) {
        showToast('Client created successfully', 'success');
        setShowClientForm(false);
        setClientForm({ name: '', email: '', phone: '', password: '' });
        refresh();
      } else showToast(data.message || 'Error creating client', 'error');
    } catch (e) { showToast('Network error', 'error'); }
    setSaving(false);
  };

  const handleSaveStaff = async () => {
    if (!staffForm.first_name || !staffForm.email || !staffForm.password) {
      showToast('Please fill required fields', 'error'); return;
    }
    setSaving(true);
    try {
      const { ok, data } = await apiPost('/api/mobile/staff/create/', { ...staffForm, role: staffRole });
      if (ok && data.success) {
        showToast((staffRole === 'admin_staff' ? 'Operator' : 'Assistant') + ' created', 'success');
        setShowStaffForm(false);
        setStaffForm({ first_name: '', last_name: '', email: '', phone: '', password: '' });
        refresh();
      } else showToast(data.message || 'Error creating staff', 'error');
    } catch (e) { showToast('Network error', 'error'); }
    setSaving(false);
  };
  const totalCards = counts.total || STATUS_CONFIG.filter(s => s.key !== 'total' && s.key !== 'pool').reduce((sum, s) => sum + (counts[s.key] || 0), 0);
  
  const quickActions = useMemo(() => {
    const actions = [];
    const perms = user?.permissions || {};
    const hasReprintPerm = perms.perm_idcard_reprint_list || perms.perm_reprint_request_list || perms.perm_confirmed_list;

    if (isSuperAdmin) {
      actions.push({ label: 'ADD CLIENT', icon: 'building', color: '#3b82f6', bg: '#eff6ff', onPress: () => setShowClientForm(true) });
      actions.push({ label: 'ADD ASSISTANT', icon: 'users', color: '#8b5cf6', bg: '#f5f3ff', onPress: () => { setStaffRole('client_staff'); setShowStaffForm(true); } });
      actions.push({ label: 'ADD OPERATOR', icon: 'user-tie', color: '#10b981', bg: '#ecfdf5', onPress: () => { setStaffRole('admin_staff'); setShowStaffForm(true); } });
      actions.push({ label: 'REPRINTS', icon: 'redo', color: '#f97316', bg: '#fff7ed', screen: 'Reprint', params: { clientId: 0 } });
    } else if (isOperator) {
      actions.push({ label: 'ADD CLIENT', icon: 'building', color: '#3b82f6', bg: '#eff6ff', onPress: () => setShowClientForm(true) });
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

  const handleBadgePress = (client, statusKey) => {
    const statusMap = { PENDING: 'p', VERIFIED: 'v', APPROVED: 'a', DOWNLOAD: 'd', POOL: 'po' };
    const statusValue = { PENDING: 'pending', VERIFIED: 'verified', APPROVED: 'approved', DOWNLOAD: 'download', POOL: 'pool' };
    
    const tablesWithStatus = (client.tables || []).filter(t => t[statusMap[statusKey]] > 0);
    
    if (tablesWithStatus.length === 0) return;
    
    if (tablesWithStatus.length === 1) {
      navigation.navigate('CardList', { tableId: tablesWithStatus[0].id, status: statusValue[statusKey] });
    } else {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      if (expandedClient?.id === client.id) {
        setExpandedClient(null);
      } else {
        setExpandedClient({ id: client.id });
      }
    }
  };

  if (loading) return (
    <View style={s.root}>
      <LinearGradient colors={gradients.brandFull} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={[s.header, { paddingTop: insets.top + 12 }]}>
        <View style={s.headerRow}>
          <View style={s.logoSquare}>
            <Image source={require('../../assets/logo.png')} style={s.logo} resizeMode="contain" />
          </View>
          <View style={s.headerCenter}><Text style={s.brandName}>Adarsh ID Cards</Text></View>
          <View style={s.profileSquare}>
            <IconProfile size={14} color="#fff" />
          </View>
        </View>
        <View style={s.searchBar}>
          <IconSearch size={13} color="rgba(255,255,255,0.5)" />
          <Text style={s.searchPlaceholder}>Search cards, names, numbers...</Text>
        </View>
      </LinearGradient>
      <ScrollView style={s.scroll}>
        <DashboardSkeleton />
      </ScrollView>
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

  const mapIcon = (faClass) => {
    if (!faClass) return 'history';
    const c = (faClass || '').toLowerCase();
    if (c.includes('check') || c.includes('verify') || c.includes('approve')) return 'check-circle';
    if (c.includes('trash') || c.includes('delete') || c.includes('remove')) return 'trash-2';
    if (c.includes('edit') || c.includes('update')) return 'edit-3';
    if (c.includes('user') || c.includes('staff')) return 'users';
    if (c.includes('building') || c.includes('client')) return 'building';
    if (c.includes('refresh') || c.includes('redo') || c.includes('history')) return 'history';
    if (c.includes('image') || c.includes('photo')) return 'image';
    if (c.includes('download')) return 'download';
    if (c.includes('login') || c.includes('bracket')) return 'log-in';
    if (c.includes('logout')) return 'log-out';
    if (c.includes('plus') || c.includes('add')) return 'plus-circle';
    if (c.includes('key')) return 'key';
    if (c.includes('print')) return 'printer';
    if (c.includes('gear') || c.includes('setting')) return 'settings';
    if (c.includes('envelope')) return 'mail';
    if (c.includes('bell')) return 'bell';
    if (c.includes('database') || c.includes('vault')) return 'database';
    return 'activity';
  };

  const mapColor = (c) => {
    if (!c) return colors.brandPrimary;
    const low = c.toLowerCase();
    if (low === 'add') return colors.green;
    if (low === 'edit') return colors.blue;
    if (low === 'delete') return colors.red;
    if (low === 'verify') return colors.purple;
    if (low === 'approve') return colors.teal;
    return c;
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  return (
    <View style={s.root}>
      <LinearGradient colors={gradients.brandFull} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={[s.header, { paddingTop: insets.top + 12 }]}>
        <View style={s.headerRow}>
          <TouchableOpacity style={s.headerLeftBtn} onPress={() => navigation.navigate('Landing')} activeOpacity={0.8}>
            <View style={s.logoSquare}>
              <Image source={require('../../assets/logo.png')} style={s.logo} resizeMode="contain" />
            </View>
          </TouchableOpacity>
          <View style={s.headerCenter}><Text style={s.brandName}>Adarsh ID Cards</Text></View>
          <View style={s.headerRight}>
            <TouchableOpacity style={s.profileBtn} onPress={() => navigation.navigate('Profile')}>
              <View style={s.profileSquare}>
                <IconProfile size={14} color="#fff" />
              </View>
            </TouchableOpacity>
          </View>
        </View>
        <TouchableOpacity style={s.searchBar} activeOpacity={0.8} onPress={() => navigation.navigate('Search')}>
          <IconSearch size={13} color="rgba(255,255,255,0.5)" />
          <Text style={s.searchPlaceholder}>Search cards, names, numbers...</Text>
        </TouchableOpacity>
      </LinearGradient>

      <ScrollView style={s.scroll} contentContainerStyle={s.scrollC} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandLight} />}>

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
            <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} snapToInterval={width}
              decelerationRate="fast" style={s.slideScroll} onMomentumScrollEnd={(e) => setCurrentSlide(Math.round(e.nativeEvent.contentOffset.x / width))}>
              
              {/* SLIDE 0: HOME SECTION (Tabs as Cards) */}
              <View style={s.slidePage}>
                <LinearGradient colors={gradients.brandFull} start={{x:0, y:0}} end={{x:1, y:0}} style={s.slideHeader}>
                  <Text style={s.slideHeaderTitle}>HOME SECTION</Text>
                </LinearGradient>
                <View style={s.slideContent}>
                  <View style={s.quickActionsRow}>
                    {[
                      { label: 'CLIENTS', icon: 'building', color: '#6366f1', bg: '#eef2ff', tab: 'clients' },
                      { label: 'ACTIVITY', icon: 'history', color: '#ec4899', bg: '#fdf2f8', tab: 'activity' },
                      { label: 'REPRINTS', icon: 'redo', color: '#f59e0b', bg: '#fffbeb', tab: 'reprints' },
                    ].map((act, i) => (
                      <TouchableOpacity key={i} style={[s.quickActionBtn, activeTab === act.tab && { borderColor: act.color, borderWidth: 1.5 }]} 
                        onPress={() => setActiveTab(act.tab)}>
                        <View style={[s.qaIcon, { backgroundColor: act.bg }]}><DynamicIcon name={act.icon} size={18} color={act.color} /></View>
                        <Text style={[s.qaLabel, activeTab === act.tab && { color: act.color }]}>{act.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>

              {/* SLIDE 1: QUICK ACTIONS */}
              <View style={s.slidePage}>
                <LinearGradient colors={gradients.brandFull} start={{x:0, y:0}} end={{x:1, y:0}} style={s.slideHeader}>
                  <Text style={s.slideHeaderTitle}>QUICK ACTIONS</Text>
                </LinearGradient>
                <View style={s.slideContent}>
                  <View style={s.quickActionsRow}>
                    {quickActions.slice(0, 3).map((act, i) => (
                      <TouchableOpacity key={i} style={s.quickActionBtn} onPress={act.onPress || (() => navigation.navigate(act.screen, act.params))}>
                        <View style={[s.qaIcon, { backgroundColor: act.bg }]}><DynamicIcon name={act.icon} size={18} color={act.color} /></View>
                        <Text style={s.qaLabel}>{act.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>

              {/* SLIDE 2: USERS OVERVIEW */}
              <View style={s.slidePage}>
                <LinearGradient colors={gradients.brandFull} start={{x:0, y:0}} end={{x:1, y:0}} style={s.slideHeader}>
                  <Text style={s.slideHeaderTitle}>USERS OVERVIEW</Text>
                </LinearGradient>
                <View style={s.slideContent}>
                  <View style={s.quickActionsRow}>
                    {[
                      { label: 'CLIENTS', icon: 'building', color: '#10b981', bg: '#ecfdf5', count: counts.client_count || 0, screen: 'ClientsList' },
                      { label: 'OPERATORS', icon: 'user-tie', color: '#3b82f6', bg: '#eff6ff', count: counts.operator_count || 0, screen: 'StaffManage', params: { role: 'admin_staff' } },
                      { label: 'ASSISTANT', icon: 'users', color: '#8b5cf6', bg: '#f5f3ff', count: counts.assistant_count || 0, screen: 'StaffManage', params: { role: 'client_staff' } },
                    ].map((act, i) => (
                      <TouchableOpacity key={i} style={s.quickActionBtn} onPress={() => navigation.navigate(act.screen, act.params)}>
                        <View style={[s.qaIcon, { backgroundColor: act.bg }]}><DynamicIcon name={act.icon} size={18} color={act.color} /></View>
                        <View style={s.qaLabelRow}>
                          <Text style={s.qaLabelSmall}>{act.label}</Text>
                          <View style={[s.qaBadge, { backgroundColor: act.color }]}>
                            <Text style={s.qaBadgeText}>{act.count}</Text>
                          </View>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>
            </ScrollView>
            <View style={s.dotRow}>
              {[0, 1, 2].map(i => <View key={i} style={[s.dot, currentSlide === i && s.dotActive]} />)}
            </View>
          </View>
        )}

        <View style={s.mainContent}>
          {isSuperAdmin || isOperator ? (
            activeTab === 'clients' ? (
              <View>
                <LinearGradient colors={gradients.brandFull} start={{x:0, y:0}} end={{x:1, y:0}} style={s.secHeaderGradient}>
                  <Text style={s.secTitleWhite}>RECENT CLIENTS</Text>
                  <TouchableOpacity onPress={() => navigation.navigate('ClientsList')}><Text style={s.viewAllLinkWhite}>VIEW ALL</Text></TouchableOpacity>
                </LinearGradient>
                <View style={s.secContent}>
                {counts.recent_clients?.length > 0 ? counts.recent_clients.map(client => {
                  const isExpanded = expandedClient?.id === client.id;
                  const expandedStatus = expandedClient?.status;
                  const statusMap = { PENDING: 'p', VERIFIED: 'v', APPROVED: 'a', DOWNLOAD: 'd', POOL: 'po' };
                  const statusValueMap = { PENDING: 'pending', VERIFIED: 'verified', APPROVED: 'approved', DOWNLOAD: 'download', POOL: 'pool' };
                  
                  return (
                    <View key={client.id} style={s.clientCardWrapper}>
                      <LinearGradient colors={gradients.brandFull} start={{x:0, y:0}} end={{x:1, y:0}} style={s.clientCardGradient}>
                        <View style={s.clientCard}>
                          <TouchableOpacity 
                            style={s.clientHeader} 
                            activeOpacity={0.7}
                            onPress={() => {
                              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                              setExpandedClient(expandedClient?.id === client.id ? null : { id: client.id });
                            }}
                          >
                            <View style={[s.clientIcon, { backgroundColor: theme.bgSoft }]}><DynamicIcon name="building" size={14} color={theme.primary} /></View>
                            <View style={s.clientInfo}><Text style={s.clientName} numberOfLines={1} ellipsizeMode="tail">{client.name}</Text></View>
                            <DynamicIcon name={expandedClient?.id === client.id ? "chevron-up" : "chevron-down"} size={10} color={colors.gray400} />
                          </TouchableOpacity>
                          <View style={s.clientStatsRow}>
                            <ClientMiniStat label="PENDING" count={client.pending} color={colors.pending.text} bg={colors.pending.bg} onPress={() => handleBadgePress(client, 'PENDING')} />
                            <ClientMiniStat label="VERIFIED" count={client.verified} color={colors.verified.text} bg={colors.verified.bg} onPress={() => handleBadgePress(client, 'VERIFIED')} />
                            <ClientMiniStat label="APPROVED" count={client.approved} color={colors.approved.text} bg={colors.approved.bg} onPress={() => handleBadgePress(client, 'APPROVED')} />
                            <ClientMiniStat label="DOWNLOAD" count={client.download} color={colors.download.text} bg={colors.download.bg} onPress={() => handleBadgePress(client, 'DOWNLOAD')} />
                            <ClientMiniStat label="POOL" count={client.pool} color={colors.pool.text} bg={colors.pool.bg} onPress={() => handleBadgePress(client, 'POOL')} />
                          </View>

                          {expandedClient?.id === client.id && (
                            <View style={s.expandedContent}>
                              <View style={s.expandedHeader}>
                                <Text style={s.expandedTitle}>TABLES / LISTS</Text>
                                <TouchableOpacity onPress={() => setExpandedClient(null)}><DynamicIcon name="times" size={10} color={colors.gray400} /></TouchableOpacity>
                              </View>
                              {(client.tables || []).map(table => (
                                <View key={table.id} style={s.expandedItem}>
                                  <View style={s.expandedItemHeader}>
                                    <Text style={s.expandedItemName}>{table.name}</Text>
                                    <Text style={s.expandedItemGroup}>{table.group}</Text>
                                  </View>
                                  <View style={s.statusButtonsRowBelow}>
                                    {[
                                      { key: 'pending', label: 'Pending', count: table.p || 0, color: colors.pending.text, bg: colors.pending.bg },
                                      { key: 'verified', label: 'Verified', count: table.v || 0, color: colors.verified.text, bg: colors.verified.bg },
                                      { key: 'approved', label: 'Approved', count: table.a || 0, color: colors.approved.text, bg: colors.approved.bg },
                                      { key: 'download', label: 'Download', count: table.d || 0, color: colors.download.text, bg: colors.download.bg },
                                      { key: 'pool', label: 'Pool', count: table.po || 0, color: colors.pool.text, bg: colors.pool.bg },
                                    ].map((stBtn) => {
                                      const hasCards = stBtn.count > 0;
                                      return (
                                        <TouchableOpacity
                                          key={stBtn.key}
                                          style={[
                                            s.stBtnBelow,
                                            { 
                                              backgroundColor: hasCards ? stBtn.bg : '#f8fafc',
                                              borderColor: hasCards ? stBtn.color : '#e2e8f0',
                                              opacity: hasCards ? 1 : 0.4
                                            }
                                          ]}
                                          disabled={!hasCards}
                                          onPress={() => navigation.navigate('CardList', { tableId: table.id, status: stBtn.key })}
                                        >
                                          <Text style={[s.stBtnTextBelow, { color: hasCards ? stBtn.color : '#94a3b8' }]}>
                                            {stBtn.label} ({stBtn.count})
                                          </Text>
                                        </TouchableOpacity>
                                      );
                                    })}
                                  </View>
                                </View>
                              ))}
                            </View>
                          )}
                        </View>
                      </LinearGradient>
                    </View>
                  );
                }) : <View style={s.emptyState}><Text style={s.emptyText}>No recent clients</Text></View>}
                </View>
              </View>
            ) : activeTab === 'activity' ? (
              <View>
                <LinearGradient colors={gradients.brandFull} start={{x:0, y:0}} end={{x:1, y:0}} style={s.secHeaderGradient}>
                  <Text style={s.secTitleWhite}>RECENT ACTIVITY</Text>
                </LinearGradient>
                <View style={s.secContent}>
                {counts.recent_activity?.length > 0 ? (
                  counts.recent_activity.slice(0, 15).map(act => (
                    <View key={act.id} style={s.activityCard}>
                      <View style={[s.activityIcon, { backgroundColor: mapColor(act.icon_color) + '15' }]}>
                        <DynamicIcon name={mapIcon(act.icon_class)} size={14} color={mapColor(act.icon_color)} />
                      </View>
                      <View style={s.activityInfo}>
                        <Text style={s.activityText} numberOfLines={2}>{act.display_text}</Text>
                        <View style={s.activityMeta}>
                          <Text style={s.activityTime}>{act.time_ago} ago</Text>
                          <Text style={s.activityDot}>•</Text>
                          <Text style={s.activityActor}>{act.actor}</Text>
                        </View>
                      </View>
                    </View>
                  ))
                ) : <View style={s.emptyState}><Text style={s.emptyText}>No activity found</Text></View>}
                </View>
              </View>
            ) : (
              <View>
                <LinearGradient colors={gradients.brandFull} start={{x:0, y:0}} end={{x:1, y:0}} style={s.secHeaderGradient}>
                  <Text style={s.secTitleWhite}>RECENT REPRINTS</Text>
                  <TouchableOpacity onPress={() => navigation.navigate('Reprint')}><Text style={s.viewAllLinkWhite}>VIEW ALL</Text></TouchableOpacity>
                </LinearGradient>
                <View style={s.secContent}>
                {counts.recent_reprints?.length > 0 ? counts.recent_reprints.map(rep => (
                  <TouchableOpacity key={rep.id} style={s.reprintCard} onPress={() => navigation.navigate('Reprint', { clientId: 0 })}>
                    <View style={[s.reprintIcon, { backgroundColor: rep.status === 'requested' ? '#fffbeb' : '#ecfdf5' }]}><DynamicIcon name="redo" size={12} color={rep.status === 'requested' ? '#f59e0b' : '#10b981'} /></View>
                    <View style={s.reprintInfo}><Text style={s.reprintTitle}>#{rep.card_id} - {rep.client_name}</Text><Text style={s.reprintSub}>{rep.status.toUpperCase()}</Text></View>
                  </TouchableOpacity>
                )) : <View style={s.emptyState}><Text style={s.emptyText}>No recent reprints</Text></View>}
                </View>
              </View>
            )
          ) : (
            <>
              <LinearGradient colors={gradients.brandFull} start={{x:0, y:0}} end={{x:1, y:0}} style={s.secHeaderGradient}>
                <Text style={s.secTitleWhite}>MY TABLES</Text>
                <TouchableOpacity onPress={() => navigation.navigate('Groups')}><Text style={s.viewAllLinkWhite}>VIEW ALL</Text></TouchableOpacity>
              </LinearGradient>
              <View style={s.secContent}>
              {counts.tables?.length > 0 ? counts.tables.map(table => (
                <TouchableOpacity key={table.id} style={s.tableCard} onPress={() => navigation.navigate('CardList', { tableId: table.id, status: 'all' })}>
                  <View style={s.tableCardTop}>
                    <View style={[s.tableIcon, { backgroundColor: theme.bgSoft }]}><DynamicIcon name="table" size={14} color={theme.primary} /></View>
                    <Text style={s.tableName}>{table.name}</Text>
                  </View>
                    {['P', 'V', 'A', 'D'].map((st, idx) => (
                      <View key={st} style={[s.statBadge, { backgroundColor: [colors.brandPrimary, '#10b981', '#3b82f6', '#8b5cf6'][idx] + '15', borderColor: [colors.brandPrimary, '#10b981', '#3b82f6', '#8b5cf6'][idx] }]}>
                        <Text style={[s.statBadgeText, { color: [colors.brandPrimary, '#10b981', '#3b82f6', '#8b5cf6'][idx] }]}>
                          {st}: {table[st.toLowerCase()] || 0}
                        </Text>
                      </View>
                    ))}
                </TouchableOpacity>
              )) : <View style={s.emptyState}><Text style={s.emptyText}>No tables found</Text></View>}
              </View>
            </>
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* MODALS */}
      <Modal visible={showClientForm} animationType="fade" transparent onRequestClose={() => setShowClientForm(false)}>
        <View style={s.modalOverlay}>
          <TouchableOpacity style={s.modalBg} activeOpacity={1} onPress={() => setShowClientForm(false)} />
          <View style={s.modalContent}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>New Client</Text>
              <TouchableOpacity onPress={() => setShowClientForm(false)}><IconClose size={20} color={colors.gray400} /></TouchableOpacity>
            </View>
            <ScrollView>
              <FormField label="CLIENT NAME *" value={clientForm.name} onChangeText={t => setClientForm(f => ({ ...f, name: t }))} />
              <FormField label="EMAIL *" value={clientForm.email} onChangeText={t => setClientForm(f => ({ ...f, email: t }))} keyboardType="email-address" />
              <FormField label="PHONE" value={clientForm.phone} onChangeText={t => setClientForm(f => ({ ...f, phone: t }))} keyboardType="phone-pad" />
              <FormField label="PASSWORD *" value={clientForm.password} onChangeText={t => setClientForm(f => ({ ...f, password: t }))} secureTextEntry />
            </ScrollView>
            <View style={s.modalFooter}>
              <TouchableOpacity style={s.modalCancel} onPress={() => setShowClientForm(false)}><Text style={s.modalCancelText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={s.modalSave} onPress={handleSaveClient} disabled={saving}>
                <LinearGradient colors={gradients.brand} style={s.modalSaveBtn}>
                  {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.modalSaveText}>CREATE CLIENT</Text>}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showStaffForm} animationType="fade" transparent onRequestClose={() => setShowStaffForm(false)}>
        <View style={s.modalOverlay}>
          <TouchableOpacity style={s.modalBg} activeOpacity={1} onPress={() => setShowStaffForm(false)} />
          <View style={s.modalContent}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>New {staffRole === 'admin_staff' ? 'Operator' : 'Assistant'}</Text>
              <TouchableOpacity onPress={() => setShowStaffForm(false)}><IconClose size={20} color={colors.gray400} /></TouchableOpacity>
            </View>
            <ScrollView>
              <View style={{ flexDirection: 'row' }}>
                <FormField label="FIRST NAME *" value={staffForm.first_name} onChangeText={t => setStaffForm(f => ({ ...f, first_name: t }))} />
                <View style={{ width: 10 }} />
                <FormField label="LAST NAME" value={staffForm.last_name} onChangeText={t => setStaffForm(f => ({ ...f, last_name: t }))} />
              </View>
              <FormField label="EMAIL *" value={staffForm.email} onChangeText={t => setStaffForm(f => ({ ...f, email: t }))} keyboardType="email-address" />
              <FormField label="PHONE" value={staffForm.phone} onChangeText={t => setStaffForm(f => ({ ...f, phone: t }))} keyboardType="phone-pad" />
              <FormField label="PASSWORD *" value={staffForm.password} onChangeText={t => setStaffForm(f => ({ ...f, password: t }))} secureTextEntry />
            </ScrollView>
            <View style={s.modalFooter}>
              <TouchableOpacity style={s.modalCancel} onPress={() => setShowStaffForm(false)}><Text style={s.modalCancelText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={s.modalSave} onPress={handleSaveStaff} disabled={saving}>
                <LinearGradient colors={gradients.brand} style={s.modalSaveBtn}>
                  {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.modalSaveText}>CREATE {staffRole === 'admin_staff' ? 'OPERATOR' : 'ASSISTANT'}</Text>}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Toast visible={toast.visible} message={toast.message} type={toast.type} onHide={() => setToast(p => ({ ...p, visible: false }))} />
    </View>
  );
}

function FormField({ label, value, onChangeText, secureTextEntry, keyboardType }) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput style={s.fieldInput} value={value} onChangeText={onChangeText} secureTextEntry={secureTextEntry} keyboardType={keyboardType} placeholderTextColor={colors.gray300} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceBg },
  header: { paddingHorizontal: 16, paddingBottom: 20, borderBottomLeftRadius: radius.sm, borderBottomRightRadius: radius.sm, ...shadows.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  logo: { width: 24, height: 24 },
  logoSquare: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  brandName: { color: '#fff', fontSize: 18, fontFamily: 'SairaSemiCondensed-Bold' },
  profileBtn: { },
  profileSquare: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.15)', marginTop: 12, paddingHorizontal: 12, height: 44, borderRadius: radius.sm, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  searchPlaceholder: { color: 'rgba(255,255,255,0.6)', fontSize: 13, marginLeft: 10, fontFamily: 'SairaSemiCondensed-Medium' },
  scroll: { flex: 1 },
  scrollC: { paddingVertical: 12 },
  statusGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4, paddingHorizontal: 12 },
  statusCardOuter: { width: (width - 44) / 3, aspectRatio: 1, borderRadius: radius.xs, overflow: 'hidden', ...shadows.sm },
  statusCard: { flex: 1, padding: 8, justifyContent: 'center' },
  statusCardContent: { alignItems: 'center' },
  statusIconCircle: { width: 28, height: 28, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  statusCount: { color: '#fff', fontSize: 16, fontFamily: 'SairaSemiCondensed-Bold' },
  statusLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 7, fontFamily: 'SairaSemiCondensed-Bold', letterSpacing: 0.5 },
  homeSectionWrap: { marginTop: 16 },
  slideScroll: { width: width },
  slidePage: { width: width, paddingBottom: 12 },
  slideContent: { paddingHorizontal: 12, paddingTop: 4 },
  homeSecTitle: { fontSize: 10, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray400, letterSpacing: 1, marginBottom: 10 },
  tabBar: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: radius.sm, padding: 4, ...shadows.sm, borderWidth: 1, borderColor: colors.gray100 },
  tabBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: radius.xs },
  tabBtnActive: { backgroundColor: colors.brandPrimary },
  tabBtnText: { fontSize: 8, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray400 },
  tabBtnTextActive: { color: '#fff' },
  quickActionsRow: { flexDirection: 'row', gap: 8 },
  quickActionBtn: { flex: 1, backgroundColor: '#fff', padding: 10, borderRadius: radius.sm, alignItems: 'center', ...shadows.sm, borderWidth: 1, borderColor: colors.gray100 },
  qaIcon: { width: 44, height: 44, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  qaInfo: { alignItems: 'center' },
  qaCount: { fontSize: 16, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray800, marginBottom: 2 },
  qaLabel: { fontSize: 10, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray600, textAlign: 'center' },
  qaLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  qaLabelSmall: { fontSize: 8, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray500 },
  qaBadge: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: radius.xs },
  qaBadgeText: { fontSize: 8, fontFamily: 'SairaSemiCondensed-Bold', color: '#fff' },
  dotRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 12, gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.gray200 },
  dotActive: { width: 16, backgroundColor: colors.brandPrimary },
  mainContent: { marginTop: 10 },
  secHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, marginTop: 10 },
  secHeaderGradient: { 
    width: '100%',
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between', 
    paddingHorizontal: 16, 
    paddingVertical: 12, 
    marginBottom: 12 
  },
  secTitle: { fontSize: 10, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray400, letterSpacing: 1 },
  secTitleWhite: { fontSize: 10, fontFamily: 'SairaSemiCondensed-Bold', color: '#fff', letterSpacing: 1 },
  viewAllLink: { fontSize: 9, fontFamily: 'SairaSemiCondensed-Bold', color: colors.brandPrimary },
  viewAllLinkWhite: { fontSize: 9, fontFamily: 'SairaSemiCondensed-Bold', color: '#fff', opacity: 0.8 },
  secContent: { paddingHorizontal: 12 },
  slideHeader: { 
    width: '100%',
    paddingHorizontal: 16, 
    paddingVertical: 14, 
    marginBottom: 12 
  },
  slideHeaderTitle: { fontSize: 9, fontFamily: 'SairaSemiCondensed-Bold', color: '#fff', letterSpacing: 1 },
  clientCardWrapper: { marginBottom: 12 },
  clientCardGradient: { borderRadius: radius.sm, padding: 1.5, ...shadows.sm },
  clientCard: { backgroundColor: '#fff', borderRadius: radius.sm - 1, padding: 10 },
  clientHeader: { flexDirection: 'row', alignItems: 'center' },
  clientIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  clientInfo: { flex: 1 },
  clientName: { fontSize: 13, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray800 },
  clientStatsRow: { flexDirection: 'row', gap: 3, marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  clientMiniStat: { alignItems: 'center', flex: 1 },
  clientMiniStatLabel: { fontSize: 7, fontFamily: 'SairaSemiCondensed-Bold', marginBottom: 4, letterSpacing: 0.3 },
  clientMiniStatBadge: { width: '100%', paddingHorizontal: 2, paddingVertical: 2, borderRadius: radius.xs, alignItems: 'center', justifyContent: 'center' },
  clientMiniStatCount: { fontSize: 10, fontFamily: 'SairaSemiCondensed-Bold' },
  expandedContent: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  expandedHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  expandedTitle: { fontSize: 8, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray400, letterSpacing: 0.5 },
  expandedItem: { flexDirection: 'column', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  expandedItemHeader: { marginBottom: 6 },
  expandedItemName: { fontSize: 12, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray800 },
  expandedItemGroup: { fontSize: 9, color: colors.gray400, fontFamily: 'SairaSemiCondensed-Medium' },
  statusButtonsRowBelow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  stBtnBelow: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stBtnTextBelow: { fontSize: 9, fontFamily: 'SairaSemiCondensed-Bold' },
  activityCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', padding: 12, borderRadius: radius.sm, marginBottom: 8, ...shadows.sm, borderWidth: 1, borderColor: colors.gray100 },
  activityIcon: { width: 36, height: 36, borderRadius: radius.xs, alignItems: 'center', justifyContent: 'center' },
  activityInfo: { flex: 1, paddingLeft: 12 },
  activityText: { fontSize: 13, color: colors.gray800, lineHeight: 18, fontFamily: 'SairaSemiCondensed-Medium' },
  activityMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  activityTime: { fontSize: 11, color: colors.gray400, fontFamily: 'SairaSemiCondensed-Regular' },
  activityDot: { fontSize: 11, color: colors.gray300, marginHorizontal: 4 },
  activityActor: { fontSize: 11, color: colors.brandPrimary, fontFamily: 'SairaSemiCondensed-Bold' },
  emptyActivity: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40, opacity: 0.6 },
  reprintCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', padding: 12, borderRadius: radius.sm, marginBottom: 8, ...shadows.sm, borderWidth: 1, borderColor: colors.gray100 },
  reprintIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  reprintTitle: { fontSize: 13, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray800 },
  reprintSub: { fontSize: 10, fontFamily: 'SairaSemiCondensed-Medium', color: colors.gray500, marginTop: 2 },
  tableCard: { backgroundColor: '#fff', borderRadius: radius.sm, padding: 12, ...shadows.sm, borderWidth: 1, borderColor: colors.gray100, marginBottom: 12 },
  tableCardTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  tableIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  tableName: { fontSize: 14, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray800 },
  tableStats: { flexDirection: 'row', justifyContent: 'space-between' },
  statBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.xs, borderWidth: 1 },
  statBadgeText: { fontSize: 9, fontFamily: 'SairaSemiCondensed-Bold' },
  fab: { position: 'absolute', bottom: 30, right: 20, width: 56, height: 56, borderRadius: radius.sm, ...shadows.xl },
  fabGradient: { width: '100%', height: '100%', borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  emptyState: { padding: 30, alignItems: 'center' },
  emptyText: { color: colors.gray400, fontSize: 12, fontFamily: 'SairaSemiCondensed-Medium' },
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalBg: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  modalContent: { backgroundColor: '#fff', borderTopLeftRadius: radius.sm, borderTopRightRadius: radius.sm, padding: 20, maxHeight: '90%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 16, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray800 },
  field: { flex: 1, marginBottom: 16 },
  fieldLabel: { fontSize: 11, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray500, marginBottom: 6 },
  fieldInput: { backgroundColor: colors.gray50, borderRadius: radius.xs, paddingHorizontal: 12, height: 44, fontSize: 13, fontFamily: 'SairaSemiCondensed-Medium', color: colors.gray800, borderWidth: 1, borderColor: colors.gray100 },
  modalFooter: { flexDirection: 'row', gap: 12, marginTop: 10, paddingTop: 10 },
  modalCancel: { flex: 1, height: 44, borderRadius: radius.xs, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.gray100 },
  modalCancelText: { fontSize: 13, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray600 },
  modalSave: { flex: 2, height: 44, borderRadius: radius.xs },
  modalSaveBtn: { flex: 1, borderRadius: radius.xs, alignItems: 'center', justifyContent: 'center' },
  modalSaveText: { fontSize: 13, fontFamily: 'SairaSemiCondensed-Bold', color: '#fff' },
});
