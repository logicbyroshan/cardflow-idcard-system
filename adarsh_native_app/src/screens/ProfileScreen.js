import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet, Alert,
} from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import { IconProfile, IconEdit, IconLogout, IconChevronRight, IconMail, IconPhone } from '../components/Icons';
import { LinearGradient } from 'expo-linear-gradient';
import TopBar from '../components/TopBar';
import Toast from '../components/Toast';
import Button from '../components/Button';
import Input from '../components/Input';
import { useAuth } from '../context/AuthContext';
import { apiPost } from '../api/client';
import { colors, radius, shadows, roleThemes } from '../theme';

export default function ProfileScreen({ navigation }) {
  const { user, refreshProfile, logout } = useAuth();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState({ name: user?.name || '', phone: user?.phone || '' });
  
  // Password Change State
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdForm, setPwdForm] = useState({ current: '', new: '', confirm: '' });

  // Fetch latest data on mount
  React.useEffect(() => {
    refreshProfile();
  }, []);

  // Keep form in sync with refreshed user
  React.useEffect(() => {
    if (user && !editing) {
      setEditForm({ name: user.name || '', phone: user.phone || '' });
    }
  }, [user, editing]);

  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });
  const theme = roleThemes[user?.role] || roleThemes.default;

  const showToast = (message, type = 'info') => setToast({ visible: true, message, type });

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
    if (pwdForm.new !== pwdForm.confirm) {
      showToast('New passwords do not match', 'error');
      return;
    }
    if (pwdForm.new.length < 6) {
      showToast('Password must be at least 6 characters', 'error');
      return;
    }

    setPwdSaving(true);
    try {
      const { data } = await apiPost('/api/mobile/profile/change-password/', {
        current_password: pwdForm.current,
        new_password: pwdForm.new
      });
      
      showToast(data.success ? (data.message || 'Password updated successfully') : (data.message || 'Failed to update password'), data.success ? 'success' : 'error');
      
      if (data.success) {
        setPwdForm({ current: '', new: '', confirm: '' });
      }
    } catch (e) {
      showToast('Network error', 'error');
    }
    setPwdSaving(false);
  };

  const handleLogout = () => Alert.alert('Sign Out', 'Are you sure?', [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign Out', style: 'destructive', onPress: () => logout() }]);

  const initials = (user?.name || 'U').slice(0, 2).toUpperCase();

  return (
    <View style={s.root}>
      <TopBar title="My Profile" onBack={() => navigation.goBack()} />
      <ScrollView style={s.scroll} contentContainerStyle={s.scrollC} showsVerticalScrollIndicator={false}>
        
        {/* Profile Card */}
        <View style={s.card}>
          <LinearGradient colors={theme.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.avatarSec}>
            <View style={s.avatar}><Text style={s.avatarTxt}>{initials}</Text></View>
            {!editing && <Text style={s.userName}>{user?.name || 'User'}</Text>}
            <View style={[s.roleBadge, { backgroundColor: 'rgba(255,255,255,0.15)' }]}>
              <Text style={s.userRole}>
                {user?.role === 'pro_user' ? 'PRO USER' : 
                 (user?.role || 'User').replace('_', ' ').toUpperCase()}
              </Text>
            </View>
          </LinearGradient>

          {!editing ? (
            <View style={s.details}>
              <InfoRow icon="envelope" c="#3b82f6" bg="#dbeafe" label="Email" value={user?.email || 'Not set'} />
              <InfoRow icon="phone" c="#22c55e" bg="#dcfce7" label="Phone" value={user?.phone || 'Not set'} />
              
              <TouchableOpacity 
                style={s.editProfileBtn} 
                onPress={() => { setEditing(true); setEditForm({ name: user?.name || '', phone: user?.phone || '' }); }}
              >
                <IconEdit size={12} color={theme.gradient[0]} style={{ marginRight: 8 }} />
                <Text style={[s.editProfileTxt, { color: theme.gradient[0] }]}>Edit Profile Info</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={s.editSec}>
              <Input label="FULL NAME" value={editForm.name} onChangeText={t => setEditForm(p => ({ ...p, name: t }))} placeholder="Your name" />
              <Input label="PHONE" value={editForm.phone} onChangeText={t => setEditForm(p => ({ ...p, phone: t }))} placeholder="Phone number" keyboardType="phone-pad" />
              <View style={s.eBtns}>
                <Button variant="secondary" onPress={() => setEditing(false)} style={s.eCancel} textStyle={s.eCancelTxt}>
                  Cancel
                </Button>
                <Button onPress={saveProfile} loading={saving} style={s.eSaveW}>
                  Save Changes
                </Button>
              </View>
            </View>
          )}
        </View>

        {/* Change Password Form (Directly Visible) */}
        <Text style={s.secTitle}>CHANGE PASSWORD</Text>
        <View style={s.pwdCard}>
          <Input label="CURRENT PASSWORD" value={pwdForm.current} onChangeText={t => setPwdForm(p => ({ ...p, current: t }))} secureTextEntry placeholder="••••••••" />
          <Input label="NEW PASSWORD" value={pwdForm.new} onChangeText={t => setPwdForm(p => ({ ...p, new: t }))} secureTextEntry placeholder="••••••••" />
          <Input label="CONFIRM NEW PASSWORD" value={pwdForm.confirm} onChangeText={t => setPwdForm(p => ({ ...p, confirm: t }))} secureTextEntry placeholder="••••••••" />

          <Button onPress={handleUpdatePassword} loading={pwdSaving} fullWidth style={s.updatePwdBtnW}>
            Update Password
          </Button>
        </View>

        {/* Account Settings */}
        <Text style={s.secTitle}>ACCOUNT SETTINGS</Text>
        <View style={s.updCard}>
          <TouchableOpacity onPress={handleLogout} style={[s.linkRow, { borderBottomWidth: 0 }]} activeOpacity={0.6}>
            <View style={[s.linkIcon, { backgroundColor: '#fee2e2' }]}><IconLogout size={12} color="#ef4444" /></View>
            <Text style={[s.linkLabel, { color: '#ef4444' }]}>Sign Out</Text>
            <IconChevronRight size={10} color={colors.gray300} />
          </TouchableOpacity>
        </View>

        <View style={s.footer}>
          <Text style={s.footerText}>Secure Session · Adarsh ID Cards</Text>
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
  scrollC: { paddingBottom: 32 },
  card: { marginHorizontal: 16, marginTop: 16, backgroundColor: '#fff', borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: '#e2e8f0', ...shadows.sm },
  avatarSec: { paddingHorizontal: 24, paddingVertical: 32, alignItems: 'center' },
  avatar: { width: 80, height: 80, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', marginBottom: 12, borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)' },
  avatarTxt: { color: '#fff', fontSize: 24, fontWeight: '800' },
  userName: { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 6 },
  roleBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: radius.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  userRole: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  details: { padding: 16 },
  editSec: { padding: 16 },
  pwdCard: { marginHorizontal: 16, padding: 16, backgroundColor: '#fff', borderRadius: radius.lg, borderWidth: 1, borderColor: '#e2e8f0', ...shadows.sm },
  eLabel: { fontSize: 11, fontWeight: '700', color: colors.gray500, letterSpacing: 0.8 },
  eInput: { backgroundColor: colors.gray50, borderWidth: 1, borderColor: '#e2e8f0', borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colors.gray700, marginTop: 6 },
  eBtns: { flexDirection: 'row', marginTop: 16 },
  eCancel: { flex: 1, paddingVertical: 14, backgroundColor: colors.gray100, borderRadius: radius.md, alignItems: 'center' },
  eCancelTxt: { fontSize: 12, fontWeight: '600', color: colors.gray600 },
  eSaveW: { flex: 2, borderRadius: radius.md, overflow: 'hidden' },
  eSave: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: radius.md },
  eSaveTxt: { fontSize: 12, fontWeight: '700', color: '#fff' },
  updatePwdBtnW: { marginTop: 20, borderRadius: radius.md, overflow: 'hidden' },
  secTitle: { fontSize: 10, fontWeight: '700', color: colors.gray400, letterSpacing: 1.2, marginHorizontal: 20, marginTop: 24, marginBottom: 8 },
  updCard: { marginHorizontal: 16, backgroundColor: '#fff', borderRadius: radius.lg, paddingHorizontal: 14, borderWidth: 1, borderColor: '#e2e8f0', ...shadows.sm },
  linkRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  linkIcon: { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  linkLabel: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.gray700 },
  editProfileBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 10, paddingVertical: 12, backgroundColor: '#f8fafc', borderRadius: radius.md, borderWidth: 1, borderColor: '#e2e8f0' },
  editProfileTxt: { fontSize: 13, fontWeight: '700' },
  footer: { marginTop: 40, alignItems: 'center', paddingBottom: 20 },
  footerText: { fontSize: 10, color: colors.gray300, fontWeight: '600', letterSpacing: 0.5 },
});

const ir = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.gray50, borderRadius: radius.md, padding: 12, borderWidth: 1, borderColor: '#f1f5f9' },
  ic: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  lb: { fontSize: 9, fontWeight: '700', color: colors.gray400, letterSpacing: 1, textTransform: 'uppercase' },
  val: { fontSize: 13, fontWeight: '600', color: colors.gray800, marginTop: 1 },
});
