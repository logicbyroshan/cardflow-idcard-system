import React, { useState, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import TopBar from '../components/TopBar';
import Toast from '../components/Toast';
import { useAuth } from '../context/AuthContext';
import { apiGet, apiPost } from '../api/client';
import { colors, gradients, typography, spacing, radius, shadows, roleThemes } from '../theme';

export default function ProfileScreen({ navigation }) {
  const { user, logout } = useAuth();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState({ name: user?.name || '', phone: user?.phone || '' });
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });
  const [updateStatus, setUpdateStatus] = useState({ loading: false, currentBuild: 'Native', latestVersion: '-', statusText: 'Checking...', statusType: 'info' });
  const theme = roleThemes[user?.role] || roleThemes.default;

  const showToast = (message, type = 'info') => setToast({ visible: true, message, type });

  React.useEffect(() => {
    (async () => {
      setUpdateStatus(p => ({ ...p, loading: true }));
      try {
        const { data } = await apiGet('/app/api/mobile-shell/config/');
        const d = data?.success ? data.data : null;
        setUpdateStatus({ loading: false, currentBuild: 'React Native', latestVersion: d?.latest_version || '-', statusText: d?.update_required ? 'Update Required' : d?.update_recommended ? 'Update Available' : 'Up to Date', statusType: d?.update_required || d?.update_recommended ? 'warn' : 'ok' });
      } catch (e) { setUpdateStatus(p => ({ ...p, loading: false, statusText: 'Unable to Check' })); }
    })();
  }, []);

  const saveProfile = async () => {
    if (!editForm.name.trim()) { showToast('Name is required', 'error'); return; }
    setSaving(true);
    try {
      const { data } = await apiPost('/app/api/profile/update/', { name: editForm.name.trim(), phone: editForm.phone.trim() });
      showToast(data.success ? (data.message || 'Profile updated!') : (data.message || 'Update failed'), data.success ? 'success' : 'error');
      if (data.success) setEditing(false);
    } catch (e) { showToast('Network error', 'error'); }
    setSaving(false);
  };

  const handleLogout = () => Alert.alert('Sign Out', 'Are you sure?', [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign Out', style: 'destructive', onPress: () => logout() }]);

  const initials = (user?.name || 'U').slice(0, 2).toUpperCase();

  return (
    <View style={s.root}>
      <TopBar title="My Profile" onBack={() => navigation.goBack()} rightAction={{ icon: editing ? 'times' : 'pen', onPress: () => { setEditing(!editing); if (!editing) setEditForm({ name: user?.name || '', phone: user?.phone || '' }); } }} />
      <ScrollView style={s.scroll} contentContainerStyle={s.scrollC} showsVerticalScrollIndicator={false}>
        {/* Profile Card */}
        <View style={s.card}>
          <LinearGradient colors={theme.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.avatarSec}>
            <View style={s.avatar}><Text style={s.avatarTxt}>{initials}</Text></View>
            {!editing && <Text style={s.userName}>{user?.name || 'User'}</Text>}
            <View style={[s.roleBadge, { backgroundColor: 'rgba(255,255,255,0.15)' }]}>
              <Text style={s.userRole}>{user?.roleLabel || (user?.role || 'User').replace('_', ' ').toUpperCase()}</Text>
            </View>
          </LinearGradient>
          {!editing ? (
            <View style={s.details}>
              <InfoRow icon="envelope" c="#3b82f6" bg="#dbeafe" label="Email" value={user?.email || 'Not set'} />
              <InfoRow icon="phone" c="#22c55e" bg="#dcfce7" label="Phone" value={user?.phone || 'Not set'} />
              <InfoRow icon="shield-alt" c="#8b5cf6" bg="#ede9fe" label="Role" value={user?.roleLabel || user?.role || 'User'} />
            </View>
          ) : (
            <View style={s.editSec}>
              <Text style={s.eLabel}>FULL NAME</Text>
              <TextInput style={s.eInput} value={editForm.name} onChangeText={t => setEditForm(p => ({ ...p, name: t }))} placeholder="Your name" placeholderTextColor={colors.gray300} />
              <Text style={[s.eLabel, { marginTop: 12 }]}>PHONE</Text>
              <TextInput style={s.eInput} value={editForm.phone} onChangeText={t => setEditForm(p => ({ ...p, phone: t }))} placeholder="Phone number" placeholderTextColor={colors.gray300} keyboardType="phone-pad" />
              <View style={s.eBtns}>
                <TouchableOpacity onPress={() => setEditing(false)} style={s.eCancel}><Text style={s.eCancelTxt}>Cancel</Text></TouchableOpacity>
                <TouchableOpacity onPress={saveProfile} disabled={saving} style={s.eSaveW}><LinearGradient colors={theme.gradient} style={s.eSave}>{saving && <ActivityIndicator size="small" color="#fff" />}<Text style={s.eSaveTxt}>Save Changes</Text></LinearGradient></TouchableOpacity>
              </View>
            </View>
          )}
        </View>
        {/* Quick Links */}
        <Text style={s.secTitle}>QUICK LINKS</Text>
        <View style={s.updCard}>
          {[
            { icon: 'search', c: '#3b82f6', bg: '#dbeafe', label: 'Search Cards', screen: 'Search' },
            { icon: 'bell', c: '#f59e0b', bg: '#fef3c7', label: 'Notifications', screen: 'Notifications' },
            { icon: 'layer-group', c: '#8b5cf6', bg: '#ede9fe', label: 'Groups & Tables', screen: 'Groups' },
            { icon: 'users', c: '#6366f1', bg: '#eef2ff', label: 'Staff Management', screen: 'StaffManage' },
            { icon: 'building', c: '#0ea5e9', bg: '#e0f2fe', label: 'Clients', screen: 'ClientsList' },
            { icon: 'cog', c: '#6b7280', bg: '#f3f4f6', label: 'Settings', screen: 'Settings' },
            { icon: 'table', c: '#10b981', bg: '#d1fae5', label: 'Table Picker', screen: 'TablePicker', params: { status: 'pending' } },
          ].map(link => (
            <TouchableOpacity key={link.screen} onPress={() => navigation.navigate(link.screen, link.params)} style={s.linkRow} activeOpacity={0.6}>
              <View style={[s.linkIcon, { backgroundColor: link.bg }]}><FontAwesome5 name={link.icon} size={12} color={link.c} solid /></View>
              <Text style={s.linkLabel}>{link.label}</Text>
              <FontAwesome5 name="chevron-right" size={10} color={colors.gray300} />
            </TouchableOpacity>
          ))}
        </View>
        {/* Update Status */}
        <Text style={s.secTitle}>APP UPDATE STATUS</Text>
        <View style={s.updCard}>
          <View style={s.updGrid}>
            <UpdBox label="Current" value={updateStatus.currentBuild} />
            <UpdBox label="Latest" value={updateStatus.latestVersion} />
            <UpdBox label="Status" value={updateStatus.statusText} color={updateStatus.statusType === 'ok' ? colors.success : updateStatus.statusType === 'warn' ? colors.warning : colors.info} />
          </View>
        </View>
        {/* Logout */}
        <View style={s.bottomAct}>
          <TouchableOpacity onPress={handleLogout} style={s.logoutBtn}><FontAwesome5 name="sign-out-alt" size={14} color="#ef4444" solid /><Text style={s.logoutTxt}>Sign Out</Text></TouchableOpacity>
        </View>
      </ScrollView>
      <Toast visible={toast.visible} message={toast.message} type={toast.type} onHide={() => setToast(p => ({ ...p, visible: false }))} />
    </View>
  );
}

function InfoRow({ icon, c, bg, label, value }) {
  return (<View style={ir.row}><View style={[ir.ic, { backgroundColor: bg }]}><FontAwesome5 name={icon} size={12} color={c} solid /></View><View><Text style={ir.lb}>{label}</Text><Text style={ir.val}>{value}</Text></View></View>);
}
function UpdBox({ label, value, color }) {
  return (<View style={ub.box}><Text style={ub.lb}>{label}</Text><Text style={[ub.val, color && { color }]}>{value}</Text></View>);
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceBg },
  scroll: { flex: 1 }, scrollC: { paddingBottom: 32 },
  card: { marginHorizontal: 16, marginTop: 16, backgroundColor: '#fff', borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: '#e2e8f0', ...shadows.sm },
  avatarSec: { paddingHorizontal: 24, paddingVertical: 32, alignItems: 'center' },
  avatar: { width: 80, height: 80, borderRadius: radius.xl, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', marginBottom: 12, borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)' },
  avatarTxt: { color: '#fff', fontSize: 24, fontWeight: '800' },
  userName: { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 6 },
  roleBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  userRole: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  details: { padding: 16, gap: 10 },
  editSec: { padding: 16 },
  eLabel: { fontSize: 11, fontWeight: '700', color: colors.gray500, letterSpacing: 0.8 },
  eInput: { backgroundColor: colors.gray50, borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colors.gray700, marginTop: 6 },
  eBtns: { flexDirection: 'row', gap: 8, marginTop: 16 },
  eCancel: { flex: 1, paddingVertical: 14, backgroundColor: colors.gray100, borderRadius: 12, alignItems: 'center' },
  eCancelTxt: { fontSize: 12, fontWeight: '600', color: colors.gray600 },
  eSaveW: { flex: 2, borderRadius: 12, overflow: 'hidden' },
  eSave: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, borderRadius: 12 },
  eSaveTxt: { fontSize: 12, fontWeight: '700', color: '#fff' },
  secTitle: { fontSize: 10, fontWeight: '700', color: colors.gray400, letterSpacing: 1.2, marginHorizontal: 20, marginTop: 16, marginBottom: 8 },
  updCard: { marginHorizontal: 16, backgroundColor: '#fff', borderRadius: 20, padding: 14, borderWidth: 1, borderColor: '#e2e8f0', ...shadows.sm },
  updGrid: { flexDirection: 'row', gap: 8 },
  bottomAct: { marginHorizontal: 16, marginTop: 16 },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca', borderRadius: 20 },
  logoutTxt: { fontSize: 13, fontWeight: '700', color: '#ef4444' },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  linkIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  linkLabel: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.gray700 },
});
const ir = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.gray50, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#f1f5f9' },
  ic: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  lb: { fontSize: 9, fontWeight: '700', color: colors.gray400, letterSpacing: 1, textTransform: 'uppercase' },
  val: { fontSize: 13, fontWeight: '600', color: colors.gray800, marginTop: 1 },
});
const ub = StyleSheet.create({
  box: { flex: 1, backgroundColor: colors.gray50, borderWidth: 1, borderColor: '#f1f5f9', borderRadius: 12, paddingVertical: 8, alignItems: 'center' },
  lb: { fontSize: 9, fontWeight: '700', color: colors.gray400, letterSpacing: 0.8, textTransform: 'uppercase' },
  val: { fontSize: 12, fontWeight: '600', color: colors.gray700, marginTop: 4 },
});
