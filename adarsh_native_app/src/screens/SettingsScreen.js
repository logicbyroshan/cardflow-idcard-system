import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, RefreshControl, TouchableOpacity, Alert } from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import TopBar from '../components/TopBar';
import Toast from '../components/Toast';
import Button from '../components/Button';
import { SettingsSkeleton } from '../components/Skeleton';
import { ErrorBanner } from '../components/NetworkGuard';
import { apiGet, apiPost } from '../api/client';
import { colors, shadows, radius, gradients, spacing } from '../theme';
import useRefreshableResource from '../hooks/useRefreshableResource';

export default function SettingsScreen({ navigation }) {
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });

  const [updateStatus, setUpdateStatus] = useState({ 
    loading: false, 
    currentBuild: 'React Native', 
    latestVersion: '-', 
    statusText: 'Checking...', 
    statusType: 'info' 
  });

  const showToast = (message, type = 'info') => setToast({ visible: true, message, type });

  const loadSettings = useCallback(async () => {
    const { ok, data: resp } = await apiGet('/app/api/settings/');
    if (!ok || !resp?.success) {
      throw new Error(resp?.message || 'Failed to load settings');
    }
    return resp.data;
  }, []);

  const { data, loading, refreshing, error, refresh } = useRefreshableResource(loadSettings);

  const checkUpdates = async () => {
    setUpdateStatus(p => ({ ...p, loading: true }));
    try {
      const { data } = await apiGet('/app/api/mobile-shell/config/');
      const d = data?.success ? data.data : null;
      setUpdateStatus({
        loading: false,
        currentBuild: 'React Native',
        latestVersion: d?.latest_version || '-',
        statusText: d?.update_required ? 'Update Required' : d?.update_recommended ? 'Update Available' : 'Up to Date',
        statusType: d?.update_required || d?.update_recommended ? 'warn' : 'ok'
      });
    } catch (e) {
      setUpdateStatus(p => ({ ...p, loading: false, statusText: 'Unable to Check' }));
    }
  };

  useEffect(() => {
    checkUpdates();
  }, []);

  const handleDeleteRequest = () => {
    Alert.alert(
      'Request Data Deletion',
      'Are you sure you want to request deletion of all your data? This action will notify the admin team and cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete My Data', style: 'destructive', onPress: async () => {
          try {
            const { data } = await apiPost('/app/api/profile/delete-request/', { confirm: true });
            showToast(data?.success ? (data.message || 'Deletion request submitted') : (data?.message || 'Failed'), data?.success ? 'success' : 'error');
          } catch (e) { showToast('Network error', 'error'); }
        }},
      ]
    );
  };

  if (loading) return (
    <View style={s.root}><TopBar title="Settings" onBack={() => navigation.goBack()} /><SettingsSkeleton /></View>
  );

  const d = data || {};

  return (
    <View style={s.root}>
      <TopBar title="Settings" subtitle="Support & System Info" onBack={() => navigation.goBack()} />
      {error && <ErrorBanner message={error} onDismiss={() => refresh()} onRetry={() => refresh()} />}
      
      <ScrollView 
        style={s.scroll} 
        contentContainerStyle={s.scrollC} 
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { refresh(); checkUpdates(); }} tintColor={colors.brandLight} />}
      >

        {/* Support Chat */}
        <Text style={s.secTitle}>SUPPORT & CHAT</Text>
        <TouchableOpacity 
          style={s.chatCard} 
          activeOpacity={0.8}
          onPress={() => navigation.navigate('Notifications')}
        >
          <LinearGradient colors={['#4f46e5', '#3730a3']} style={s.chatGradient}>
            <View style={s.chatInfo}>
              <View style={s.chatIconW}><FontAwesome5 name="comments" size={18} color="#fff" /></View>
              <View>
                <Text style={s.chatTitle}>Admin Support Chat</Text>
                <Text style={s.chatSub}>Direct line to the admin team</Text>
              </View>
            </View>
            <FontAwesome5 name="chevron-right" size={14} color="rgba(255,255,255,0.6)" />
          </LinearGradient>
        </TouchableOpacity>

        {/* App Update Status */}
        <Text style={s.secTitle}>APP UPDATE STATUS</Text>
        <View style={s.updCard}>
          <View style={s.updGrid}>
            <UpdBox label="Current" value={updateStatus.currentBuild} />
            <UpdBox label="Latest" value={updateStatus.latestVersion} />
            <UpdBox 
              label="Status" 
              value={updateStatus.statusText} 
              color={updateStatus.statusType === 'ok' ? '#22c55e' : updateStatus.statusType === 'warn' ? '#f59e0b' : '#3b82f6'} 
            />
          </View>
          {updateStatus.loading && <ActivityIndicator size="small" color={colors.brandPrimary} style={{marginTop: 10}} />}
        </View>

        {/* Data Management */}
        <Text style={s.secTitle}>DATA MANAGEMENT</Text>
        <View style={s.dangerCard}>
          <View style={s.deleteRow}>
            <View style={s.deleteIconW}><FontAwesome5 name="trash-alt" size={14} color="#ef4444" /></View>
            <View style={{flex: 1}}>
              <Text style={s.deleteTitle}>Request Account Deletion</Text>
              <Text style={s.deleteSub}>Permanently remove your data from our servers</Text>
            </View>
          </View>
          <Button variant="danger" onPress={handleDeleteRequest} fullWidth style={s.deleteCta}>
            Request Deletion
          </Button>
        </View>

        {/* System Info */}
        <Text style={s.secTitle}>SYSTEM INFORMATION</Text>
        <View style={s.sysCard}>
          <InfoRow label="App Version" value={d.app_version || '1.0.0'} />
          <InfoRow label="Environment" value={d.debug_mode ? 'Development' : 'Production'} />
          <InfoRow label="API Status" value="Online" valueColor="#22c55e" />
          <InfoRow label="Platform" value="Expo / React Native" />
        </View>

        <View style={s.footer}>
          <Text style={s.footerText}>Adarsh ID Cards · Secure ID Management</Text>
        </View>

      </ScrollView>
      <Toast visible={toast.visible} message={toast.message} type={toast.type} onHide={() => setToast(p => ({ ...p, visible: false }))} />
    </View>
  );
}

function UpdBox({ label, value, color }) {
  return (
    <View style={ub.box}>
      <Text style={ub.lb}>{label}</Text>
      <Text style={[ub.val, color && { color }]}>{value}</Text>
    </View>
  );
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
  scroll: { flex: 1 }, 
  scrollC: { paddingBottom: 40 },
  secTitle: { fontSize: 10, fontWeight: '800', color: colors.gray400, letterSpacing: 1.2, marginHorizontal: 20, marginTop: 24, marginBottom: 10, textTransform: 'uppercase' },
  
  // Chat Card
  chatCard: { marginHorizontal: 16, borderRadius: radius.lg, overflow: 'hidden', ...shadows.md },
  chatGradient: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 18 },
  chatInfo: { flexDirection: 'row', alignItems: 'center' },
  chatIconW: { width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  chatTitle: { fontSize: 15, fontWeight: '700', color: '#fff' },
  chatSub: { fontSize: 11, color: 'rgba(255,255,255,0.7)', marginTop: 2 },

  // Update Card
  updCard: { marginHorizontal: 16, backgroundColor: '#fff', borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: '#e2e8f0', ...shadows.sm },
  updGrid: { flexDirection: 'row' },
  
  // Danger Card
  dangerCard: { marginHorizontal: 16, backgroundColor: '#fff', borderRadius: radius.lg, borderWidth: 1, borderColor: '#fee2e2', overflow: 'hidden', ...shadows.sm },
  deleteRow: { flexDirection: 'row', alignItems: 'center', padding: 16 },
  deleteCta: { margin: 16, marginTop: 0 },
  deleteIconW: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#fef2f2', alignItems: 'center', justifyContent: 'center' },
  deleteTitle: { fontSize: 13, fontWeight: '700', color: colors.gray800 },
  deleteSub: { fontSize: 10, color: colors.gray400, marginTop: 2 },

  // System Card
  sysCard: { marginHorizontal: 16, backgroundColor: '#fff', borderRadius: radius.lg, borderWidth: 1, borderColor: '#e2e8f0', overflow: 'hidden', ...shadows.sm },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f8fafc' },
  infoLabel: { fontSize: 12, fontWeight: '500', color: colors.gray500 },
  infoValue: { fontSize: 12, fontWeight: '600', color: colors.gray800 },

  footer: { marginTop: 40, alignItems: 'center', paddingBottom: 20 },
  footerText: { fontSize: 10, color: colors.gray300, fontWeight: '600', letterSpacing: 0.5 },
});

const ub = StyleSheet.create({
  box: { flex: 1, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#f1f5f9', borderRadius: radius.md, paddingVertical: 10, alignItems: 'center' },
  lb: { fontSize: 9, fontWeight: '700', color: colors.gray400, letterSpacing: 0.8, textTransform: 'uppercase' },
  val: { fontSize: 12, fontWeight: '700', color: colors.gray700, marginTop: 4 },
});
