import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet, Alert, ActivityIndicator, RefreshControl,
  Linking
} from 'react-native';
import { IconProfile, IconEdit, IconLogout, IconChevronRight, IconMail, IconPhone, DynamicIcon } from '../components/Icons';
import { LinearGradient } from 'expo-linear-gradient';
import TopBar from '../components/TopBar';
import Toast from '../components/Toast';
import Button from '../components/Button';
import Input from '../components/Input';
import { useAuth } from '../context/AuthContext';
import { apiGet, apiPost } from '../api/client';
import { colors, radius, shadows, roleThemes, gradients, fontFamily } from '../theme';

export default function ProfileScreen({ navigation }) {
  const { user, refreshProfile, logout, isImpersonating, stopImpersonation } = useAuth();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState({ name: user?.name || '', phone: user?.phone || '' });
  
  // Password Change State
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdForm, setPwdForm] = useState({ current: '', new: '', confirm: '' });

  // Settings / Update State
  const [refreshing, setRefreshing] = useState(false);
  const [updateStatus, setUpdateStatus] = useState({ 
    loading: false, 
    currentBuild: 'React Native', 
    latestVersion: '-', 
    statusText: 'Checking...', 
    statusType: 'info' 
  });
  const [systemInfo, setSystemInfo] = useState(null);

  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });
  const theme = roleThemes[user?.role] || roleThemes.default;

  const showToast = (message, type = 'info') => setToast({ visible: true, message, type });

  const loadData = useCallback(async () => {
    setRefreshing(true);
    await refreshProfile();
    await checkUpdates();
    await loadSystemSettings();
    setRefreshing(false);
  }, [refreshProfile]);

  const loadSystemSettings = async () => {
    try {
      const { ok, data } = await apiGet('/api/mobile/settings/');
      if (ok && data?.success) setSystemInfo(data.data);
    } catch (e) {}
  };

  const checkUpdates = async () => {
    setUpdateStatus(p => ({ ...p, loading: true }));
    try {
      const { data } = await apiGet('/api/mobile/mobile-shell/config/');
      const d = data?.success ? data.data : null;
      setUpdateStatus({
        loading: false,
        currentBuild: 'React Native',
        latestVersion: d?.latest_version || '-',
        statusText: d?.update_required ? 'Update Required' : d?.update_recommended ? 'Update Available' : 'Up to Date',
        statusType: d?.update_required || d?.update_recommended ? 'warn' : 'ok'
      });
    } catch (e) {
      setUpdateStatus(p => ({ ...p, loading: false, statusText: 'Offline' }));
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const saveProfile = async () => {
    if (!editForm.name.trim()) { showToast('Name is required', 'error'); return; }
    setSaving(true);
    try {
      const { data } = await apiPost('/api/mobile/profile/update/', { name: editForm.name.trim(), phone: editForm.phone.trim() });
      showToast(data.success ? (data.message || 'Profile updated!') : (data.message || 'Update failed'), data.success ? 'success' : 'error');
      if (data.success) setEditing(false);
    } catch (e) { showToast('Network error', 'error'); }
    setSaving(false);
  };

  const handleUpdatePassword = async () => {
    if (!pwdForm.current || !pwdForm.new || !pwdForm.confirm) {
      showToast('All fields are required', 'error');
      return;
    }
    if (pwdForm.new !== pwdForm.confirm) { showToast('Passwords do not match', 'error'); return; }
    if (pwdForm.new.length < 6) { showToast('Min 6 characters', 'error'); return; }

    setPwdSaving(true);
    try {
      const { data } = await apiPost('/api/mobile/profile/change-password/', {
        current_password: pwdForm.current,
        new_password: pwdForm.new
      });
      showToast(data.success ? 'Password updated' : (data.message || 'Failed'), data.success ? 'success' : 'error');
      if (data.success) setPwdForm({ current: '', new: '', confirm: '' });
    } catch (e) { showToast('Network error', 'error'); }
    setPwdSaving(false);
  };

  const handleDeleteRequest = () => {
    Alert.alert('Delete My Data', 'This will permanently remove your account data. Proceed?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Request Deletion', style: 'destructive', onPress: async () => {
        try {
          const { data } = await apiPost('/api/mobile/profile/delete-request/', { confirm: true });
          showToast(data?.message || 'Request sent', data?.success ? 'success' : 'error');
        } catch (e) { showToast('Network error', 'error'); }
      }}
    ]);
  };

  const initials = (user?.name || 'U').slice(0, 2).toUpperCase();

  return (
    <View style={s.root}>
      <TopBar title="Profile & Settings" onBack={() => navigation.goBack()} />
      <ScrollView 
        style={s.scroll} 
        contentContainerStyle={s.scrollC} 
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadData} tintColor={colors.brandPrimary} />}
      >
        
        <View style={s.card}>
          <LinearGradient colors={theme.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.avatarSec}>
            <View style={s.avatar}><Text style={s.avatarTxt}>{initials}</Text></View>
            {!editing && <Text style={s.userName}>{user?.name || 'User'}</Text>}
            <View style={[s.roleBadge, { backgroundColor: 'rgba(255,255,255,0.15)' }]}>
              <Text style={s.userRole}>{(user?.role || 'User').replace('_', ' ').toUpperCase()}</Text>
            </View>
          </LinearGradient>

          {!editing ? (
            <View style={s.details}>
              <InfoRow icon="envelope" c="#3b82f6" bg="#eff6ff" label="Email" value={user?.email || 'Not set'} />
              <InfoRow icon="phone" c="#10b981" bg="#ecfdf5" label="Phone" value={user?.phone || 'Not set'} />
              <TouchableOpacity style={s.editProfileBtn} onPress={() => { setEditing(true); setEditForm({ name: user?.name || '', phone: user?.phone || '' }); }}>
                <IconEdit size={12} color={colors.brandPrimary} style={{ marginRight: 8 }} />
                <Text style={s.editProfileTxt}>Edit Profile</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={s.editSec}>
              <Input label="FULL NAME" value={editForm.name} onChangeText={t => setEditForm(p => ({ ...p, name: t }))} />
              <Input label="PHONE" value={editForm.phone} onChangeText={t => setEditForm(p => ({ ...p, phone: t }))} keyboardType="phone-pad" />
              <View style={s.eBtns}>
                <Button variant="secondary" onPress={() => setEditing(false)} style={s.eCancel}>Cancel</Button>
                <Button onPress={saveProfile} loading={saving} style={s.eSaveW}>Save</Button>
              </View>
            </View>
          )}
        </View>

        <Text style={s.secTitle}>CHANGE PASSWORD</Text>
        <View style={s.pwdCard}>
          <Input label="CURRENT PASSWORD" value={pwdForm.current} onChangeText={t => setPwdForm(p => ({ ...p, current: t }))} secureTextEntry />
          <Input label="NEW PASSWORD" value={pwdForm.new} onChangeText={t => setPwdForm(p => ({ ...p, new: t }))} secureTextEntry />
          <Input label="CONFIRM PASSWORD" value={pwdForm.confirm} onChangeText={t => setPwdForm(p => ({ ...p, confirm: t }))} secureTextEntry />
          <Button onPress={handleUpdatePassword} loading={pwdSaving} fullWidth style={{ marginTop: 10 }}>Update Password</Button>
        </View>

        <Text style={s.secTitle}>APP & SYSTEM INFO</Text>
        <View style={s.sysCard}>
          <View style={s.updGrid}>
            <View style={s.updBox}>
              <Text style={s.updLabel}>VERSION</Text>
              <Text style={s.updValue}>{systemInfo?.app_version || '1.0.0'}</Text>
            </View>
            <View style={s.updBox}>
              <Text style={s.updLabel}>BUILD</Text>
              <Text style={s.updValue}>RN-PROD</Text>
            </View>
            <View style={s.updBox}>
              <Text style={s.updLabel}>STATUS</Text>
              <Text style={[s.updValue, { color: updateStatus.statusType === 'warn' ? colors.brandPrimary : '#22c55e' }]}>
                {updateStatus.statusText}
              </Text>
            </View>
          </View>
          <TouchableOpacity onPress={checkUpdates} style={s.checkUpdBtn}>
            <Text style={s.checkUpdTxt}>Check for Updates</Text>
          </TouchableOpacity>
        </View>

        <Text style={s.secTitle}>ACCOUNT SETTINGS</Text>
        <View style={s.updCard}>
          {isImpersonating && (
            <TouchableOpacity 
              onPress={async () => {
                const res = await stopImpersonation();
                if (res.success) {
                  showToast(res.message, 'success');
                  navigation.reset({ index: 0, routes: [{ name: 'ClientsList' }] });
                } else {
                  showToast(res.message, 'error');
                }
              }} 
              style={s.linkRow}
            >
              <View style={[s.linkIcon, { backgroundColor: '#fef3c7' }]}><DynamicIcon name="user-check" size={12} color="#d97706" /></View>
              <Text style={[s.linkLabel, { color: '#d97706' }]}>Exit Impersonation</Text>
            </TouchableOpacity>
          )}
          {user?.permissions?.perm_manage_client_staff && (
            <TouchableOpacity onPress={() => navigation.navigate('StaffManage', { role: 'client_staff' })} style={s.linkRow}>
              <View style={[s.linkIcon, { backgroundColor: '#f5f3ff' }]}><DynamicIcon name="users" size={12} color="#8b5cf6" /></View>
              <Text style={s.linkLabel}>Manage Assistants</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={handleDeleteRequest} style={s.linkRow}>
            <View style={[s.linkIcon, { backgroundColor: '#fee2e2' }]}><DynamicIcon name="trash" size={12} color="#ef4444" /></View>
            <Text style={[s.linkLabel, { color: '#ef4444' }]}>Delete Data Request</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('Mpin', { mode: 'change' })} style={s.linkRow}>
            <View style={[s.linkIcon, { backgroundColor: '#eff6ff' }]}><DynamicIcon name="key" size={12} color={colors.brandPrimary} /></View>
            <Text style={s.linkLabel}>Change MPIN</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            onPress={async () => {
              if (isImpersonating) {
                // Exit impersonation instead of full sign-out
                const res = await stopImpersonation();
                if (res.success) {
                  showToast('Impersonation ended', 'success');
                  navigation.reset({ index: 0, routes: [{ name: 'ClientsList' }] });
                } else {
                  showToast(res.message || 'Failed to exit impersonation', 'error');
                }
              } else {
                logout();
              }
            }} 
            style={[s.linkRow, { borderBottomWidth: 0 }]}
          >
            <View style={[s.linkIcon, { backgroundColor: isImpersonating ? '#fef3c7' : colors.gray50 }]}>
              <IconLogout size={12} color={isImpersonating ? '#d97706' : colors.gray600} />
            </View>
            <Text style={[s.linkLabel, isImpersonating && { color: '#d97706' }]}>
              {isImpersonating ? 'Exit Impersonation & Sign Out' : 'Sign Out'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={s.footer}>
          <Text style={s.footerText}>Secure Session · Adarsh ID Cards v1.0</Text>
        </View>

      </ScrollView>
      <Toast visible={toast.visible} message={toast.message} type={toast.type} onHide={() => setToast(p => ({ ...p, visible: false }))} />
    </View>
  );
}

function InfoRow({ icon, c, bg, label, value }) {
  return (
    <View style={ir.row}>
      <View style={[ir.ic, { backgroundColor: bg }]}>
        {icon === 'envelope' ? <IconMail size={12} color={c} /> : <IconPhone size={12} color={c} />}
      </View>
      <View>
        <Text style={ir.lb}>{label}</Text>
        <Text style={ir.val}>{value}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceBg },
  scroll: { flex: 1 }, 
  scrollC: { paddingBottom: 40 },
  card: { marginHorizontal: 16, marginTop: 16, backgroundColor: '#fff', borderRadius: radius.sm, overflow: 'hidden', borderWidth: 1, borderColor: '#e2e8f0', ...shadows.sm },
  avatarSec: { paddingHorizontal: 24, paddingVertical: 24, alignItems: 'center' },
  avatar: { width: 70, height: 70, borderRadius: radius.xs, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', marginBottom: 12, borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)' },
  avatarTxt: { color: '#fff', fontSize: 24, fontFamily: 'SairaSemiCondensed-Bold' },
  userName: { color: '#fff', fontSize: 18, fontFamily: 'SairaSemiCondensed-Bold', marginBottom: 4 },
  roleBadge: { paddingHorizontal: 10, paddingVertical: 2, borderRadius: radius.xs, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  userRole: { color: '#fff', fontSize: 9, fontFamily: 'SairaSemiCondensed-Bold', letterSpacing: 0.5 },
  details: { padding: 16 },
  editSec: { padding: 16 },
  pwdCard: { marginHorizontal: 16, padding: 16, backgroundColor: '#fff', borderRadius: radius.sm, borderWidth: 1, borderColor: '#e2e8f0', ...shadows.sm },
  eBtns: { flexDirection: 'row', marginTop: 16, gap: 10 },
  eCancel: { flex: 1, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.gray100, borderRadius: radius.xs },
  eSaveW: { flex: 2 },
  secTitle: { fontSize: 9, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray400, letterSpacing: 1.2, marginHorizontal: 20, marginTop: 24, marginBottom: 8, textTransform: 'uppercase' },
  updCard: { marginHorizontal: 16, backgroundColor: '#fff', borderRadius: radius.sm, paddingHorizontal: 14, borderWidth: 1, borderColor: '#e2e8f0', ...shadows.sm },
  linkRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  linkIcon: { width: 32, height: 32, borderRadius: radius.xs, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  linkLabel: { flex: 1, fontSize: 13, fontFamily: 'SairaSemiCondensed-SemiBold', color: colors.gray700 },
  editProfileBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 10, paddingVertical: 10, backgroundColor: '#f8fafc', borderRadius: radius.xs, borderWidth: 1, borderColor: '#e2e8f0' },
  editProfileTxt: { fontSize: 13, fontFamily: 'SairaSemiCondensed-Bold', color: colors.brandPrimary },
  
  sysCard: { marginHorizontal: 16, backgroundColor: '#fff', borderRadius: radius.sm, padding: 16, borderWidth: 1, borderColor: '#e2e8f0', ...shadows.sm },
  updGrid: { flexDirection: 'row', gap: 10 },
  updBox: { flex: 1, backgroundColor: colors.gray50, borderRadius: radius.xs, padding: 8, alignItems: 'center', borderWidth: 1, borderColor: '#f1f5f9' },
  updLabel: { fontSize: 8, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray400 },
  updValue: { fontSize: 11, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray700, marginTop: 2 },
  checkUpdBtn: { marginTop: 12, alignItems: 'center' },
  checkUpdTxt: { fontSize: 11, fontFamily: 'SairaSemiCondensed-Bold', color: colors.brandPrimary },

  footer: { marginTop: 40, alignItems: 'center', paddingBottom: 20 },
  footerText: { fontSize: 10, color: colors.gray300, fontFamily: 'SairaSemiCondensed-SemiBold' },
});

const ir = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.gray50, borderRadius: radius.sm, padding: 10, borderWidth: 1, borderColor: '#f1f5f9', marginBottom: 8 },
  ic: { width: 36, height: 36, borderRadius: radius.xs, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  lb: { fontSize: 8, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray400, textTransform: 'uppercase' },
  val: { fontSize: 12, fontFamily: 'SairaSemiCondensed-SemiBold', color: colors.gray800 },
});
