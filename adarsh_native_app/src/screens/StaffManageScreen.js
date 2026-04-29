import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet, ActivityIndicator, Alert, Switch, RefreshControl } from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import TopBar from '../components/TopBar';
import Toast from '../components/Toast';
import { ListSkeleton } from '../components/Skeleton';
import { ErrorBanner } from '../components/NetworkGuard';
import { apiGet, apiPost } from '../api/client';
import { colors, gradients, shadows } from '../theme';

export default function StaffManageScreen({ navigation }) {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', phone: '', password: '' });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });

  const showToast = (msg, type = 'info') => setToast({ visible: true, message: msg, type });

  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const loadStaff = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const { ok, data } = await apiGet('/app/api/staff/');
      if (ok && data?.success) {
        setStaff(data.data?.staff || []);
      } else {
        setError(data?.message || 'Failed to load staff');
      }
    } catch (e) {
      setError('Network error - check your connection');
    }
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => { loadStaff(); }, []);

  const openCreate = () => {
    setEditingId(null);
    setForm({ first_name: '', last_name: '', email: '', phone: '', password: '' });
    setShowForm(true);
  };

  const openEdit = (member) => {
    setEditingId(member.id);
    const nameParts = (member.name || '').split(' ');
    setForm({ first_name: nameParts[0] || '', last_name: nameParts.slice(1).join(' ') || '', email: member.email || '', phone: member.phone || '', password: '' });
    setShowForm(true);
  };

  const saveForm = async () => {
    if (!form.first_name.trim()) { showToast('First name is required', 'error'); return; }
    if (!editingId && !form.email.trim()) { showToast('Email is required', 'error'); return; }
    setSaving(true);
    try {
      const url = editingId ? `/app/api/staff/${editingId}/update/` : '/app/api/staff/create/';
      const body = { ...form };
      if (!body.password) delete body.password;
      const { data } = await apiPost(url, body);
      showToast(data?.success ? (data.message || 'Saved!') : (data?.message || 'Failed'), data?.success ? 'success' : 'error');
      if (data?.success) { setShowForm(false); loadStaff(); }
    } catch (e) { showToast('Network error', 'error'); }
    setSaving(false);
  };

  const toggleActive = async (member) => {
    try {
      const { data } = await apiPost(`/app/api/staff/${member.id}/toggle/`, {});
      showToast(data?.success ? (data.message || 'Toggled') : (data?.message || 'Failed'), data?.success ? 'success' : 'error');
      if (data?.success) loadStaff();
    } catch (e) { showToast('Network error', 'error'); }
  };

  const deleteMember = (member) => {
    Alert.alert('Delete Staff?', `Are you sure you want to delete ${member.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          const { data } = await apiPost(`/app/api/staff/${member.id}/delete/`, {});
          showToast(data?.success ? (data.message || 'Deleted') : (data?.message || 'Failed'), data?.success ? 'success' : 'error');
          if (data?.success) loadStaff();
        } catch (e) { showToast('Network error', 'error'); }
      }},
    ]);
  };

  const renderItem = ({ item }) => (
    <View style={s.card}>
      <View style={s.cardTop}>
        <View style={s.avatar}><Text style={s.avatarText}>{(item.name || 'S').slice(0, 2).toUpperCase()}</Text></View>
        <View style={s.cardInfo}>
          <Text style={s.name} numberOfLines={1}>{item.name}</Text>
          <Text style={s.email} numberOfLines={1}>{item.email}</Text>
        </View>
        <View style={[s.statusDot, { backgroundColor: item.is_active ? '#22c55e' : '#ef4444' }]} />
      </View>
      <View style={s.cardActions}>
        <View style={s.toggleRow}>
          <Text style={s.toggleLabel}>Active</Text>
          <Switch 
            value={item.is_active} 
            onValueChange={() => toggleActive(item)} 
            trackColor={{ true: colors.brandPrimary }} 
            thumbColor="#fff" 
            style={{ transform: [{ scaleX: 0.7 }, { scaleY: 0.7 }] }}
          />
        </View>
        <TouchableOpacity onPress={() => openEdit(item)} style={s.actionBtn}><FontAwesome5 name="pen" size={10} color={colors.brandPrimary} /></TouchableOpacity>
        <TouchableOpacity onPress={() => deleteMember(item)} style={s.actionBtn}><FontAwesome5 name="trash-alt" size={10} color="#ef4444" /></TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={s.root}>
      <TopBar title="Staff Management" subtitle="Manage operators & assistants" onBack={() => navigation.goBack()} rightAction={{ icon: 'plus', onPress: openCreate }} />

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} onRetry={() => loadStaff(true)} />}
      {loading ? (
        <ListSkeleton rows={5} />
      ) : (
        <FlatList
          data={staff}
          renderItem={renderItem}
          keyExtractor={item => item.id.toString()}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadStaff(true)} tintColor={colors.brandLight} />}
          ListEmptyComponent={<View style={s.empty}><View style={s.emptyIcon}><FontAwesome5 name="users" size={24} color={colors.gray300} /></View><Text style={s.emptyTitle}>No staff members</Text></View>}
        />
      )}

      {/* Create/Edit Form Modal */}
      {showForm && (
        <View style={s.modalOverlay}>
          <TouchableOpacity style={s.modalBg} activeOpacity={1} onPress={() => setShowForm(false)} />
          <View style={s.modalSheet}>
            <View style={s.modalHandle} />
            <Text style={s.modalTitle}>{editingId ? 'Edit Staff' : 'Add New Staff'}</Text>
            <View style={s.formFields}>
              <View style={s.formRow}>
                <FormField label="FIRST NAME" value={form.first_name} onChangeText={t => setForm(p => ({ ...p, first_name: t }))} placeholder="First name" />
                <FormField label="LAST NAME" value={form.last_name} onChangeText={t => setForm(p => ({ ...p, last_name: t }))} placeholder="Last name" />
              </View>
              <FormField label="EMAIL" value={form.email} onChangeText={t => setForm(p => ({ ...p, email: t }))} placeholder="email@example.com" keyboardType="email-address" disabled={!!editingId} />
              <FormField label="PHONE" value={form.phone} onChangeText={t => setForm(p => ({ ...p, phone: t }))} placeholder="Phone number" keyboardType="phone-pad" />
              {!editingId && <FormField label="PASSWORD" value={form.password} onChangeText={t => setForm(p => ({ ...p, password: t }))} placeholder="Min 6 characters" secureTextEntry />}
            </View>
            <View style={s.formBtns}>
              <TouchableOpacity onPress={() => setShowForm(false)} style={s.cancelBtn}><Text style={s.cancelBtnText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity onPress={saveForm} disabled={saving} style={s.saveBtnWrap}>
                <LinearGradient colors={gradients.brand} style={s.saveBtn}>
                  {saving && <ActivityIndicator size="small" color="#fff" />}
                  <Text style={s.saveBtnText}>{editingId ? 'Update' : 'Create'}</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      <Toast visible={toast.visible} message={toast.message} type={toast.type} onHide={() => setToast(p => ({ ...p, visible: false }))} />
    </View>
  );
}

function FormField({ label, value, onChangeText, placeholder, keyboardType, secureTextEntry, disabled }) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput style={[s.fieldInput, disabled && s.fieldDisabled]} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.gray300} keyboardType={keyboardType} secureTextEntry={secureTextEntry} editable={!disabled} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceBg },
  loadWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 12, gap: 10, paddingBottom: 32 },
  card: { backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: '#f1f5f9', overflow: 'hidden', ...shadows.sm },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  avatar: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: 'rgba(51,183,239,0.08)', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 13, fontWeight: '800', color: colors.brandPrimary, fontFamily: 'SairaSemiCondensed-Bold' },
  cardInfo: { flex: 1, minWidth: 0 },
  name: { fontSize: 14, fontWeight: '700', color: colors.gray800, fontFamily: 'SairaSemiCondensed-Bold' },
  email: { fontSize: 11, color: colors.gray400, marginTop: 1, fontFamily: 'SairaSemiCondensed-Medium' },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  cardActions: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#f8fafc', paddingHorizontal: 12, paddingVertical: 6, gap: 6 },
  toggleRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  toggleLabel: { fontSize: 11, fontWeight: '600', color: colors.gray500, fontFamily: 'SairaSemiCondensed-Medium' },
  actionBtn: { width: 32, height: 32, borderRadius: radius.xs, backgroundColor: '#f8fafc', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#f1f5f9' },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyIcon: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.gray50, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: 14, fontWeight: '600', color: colors.gray400, fontFamily: 'SairaSemiCondensed-Bold' },
  // Modal
  modalOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100 },
  modalBg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' },
  modalSheet: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#fff', borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl, paddingBottom: 40, ...shadows.xl },
  modalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#e2e8f0', alignSelf: 'center', marginTop: 12, marginBottom: 10 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: colors.gray800, paddingHorizontal: 20, marginBottom: 20, fontFamily: 'SairaSemiCondensed-Bold' },
  formFields: { paddingHorizontal: 20, gap: 12 },
  formRow: { flexDirection: 'row', gap: 10 },
  field: { flex: 1 },
  fieldLabel: { fontSize: 10, fontWeight: '800', color: colors.gray400, letterSpacing: 1, marginBottom: 6, fontFamily: 'SairaSemiCondensed-Bold' },
  fieldInput: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#f1f5f9', borderRadius: radius.sm, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: colors.gray800, fontFamily: 'SairaSemiCondensed-Medium' },
  fieldDisabled: { backgroundColor: '#f1f5f9', color: colors.gray400 },
  formBtns: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, marginTop: 24 },
  cancelBtn: { flex: 1, paddingVertical: 14, backgroundColor: '#f1f5f9', borderRadius: radius.md, alignItems: 'center' },
  cancelBtnText: { fontSize: 14, fontWeight: '700', color: colors.gray600, fontFamily: 'SairaSemiCondensed-Bold' },
  saveBtnWrap: { flex: 2, borderRadius: radius.md, overflow: 'hidden', ...shadows.md },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 },
  saveBtnText: { fontSize: 14, fontWeight: '800', color: '#fff', fontFamily: 'SairaSemiCondensed-Bold' },
});
