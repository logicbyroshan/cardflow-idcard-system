import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet, ActivityIndicator, Alert, Switch } from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import TopBar from '../components/TopBar';
import Toast from '../components/Toast';
import { apiGet, apiPost } from '../api/client';
import { ListSkeleton } from '../components/Skeleton';
import { colors, gradients, shadows } from '../theme';

export default function ClientsListScreen({ navigation }) {
  const [clients, setClients] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '' });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });

  const showToast = (msg, type = 'info') => setToast({ visible: true, message: msg, type });

  const loadClients = async () => {
    try {
      // Use table picker API for client list (clients are implied by table groups)
      // For direct client management, use impersonate users endpoint
      const { data } = await apiGet('/app/api/impersonate/users/');
      if (data?.success) {
        const cl = (data.data || data.users || []).map(c => ({
          id: c.id, name: c.name || c.full_name || '', email: c.email || '',
          phone: c.phone || '', is_active: c.is_active !== false, role: c.role || '',
        }));
        setClients(cl);
        setFiltered(cl);
      }
    } catch (e) { /* silent */ }
    setLoading(false);
  };

  useEffect(() => { loadClients(); }, []);

  useEffect(() => {
    if (!search.trim()) { setFiltered(clients); return; }
    const q = search.toLowerCase();
    setFiltered(clients.filter(c => (c.name || '').toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q)));
  }, [search, clients]);

  const openCreate = () => {
    setEditingId(null);
    setForm({ name: '', email: '', phone: '', password: '' });
    setShowForm(true);
  };

  const openEdit = async (client) => {
    setEditingId(client.id);
    try {
      const { data } = await apiGet(`/app/api/client/${client.id}/`);
      if (data?.success) {
        const c = data.client || {};
        setForm({ name: c.name || client.name || '', email: c.email || client.email || '', phone: c.phone || client.phone || '', password: '' });
      } else {
        setForm({ name: client.name || '', email: client.email || '', phone: client.phone || '', password: '' });
      }
    } catch (e) {
      setForm({ name: client.name || '', email: client.email || '', phone: client.phone || '', password: '' });
    }
    setShowForm(true);
  };

  const saveForm = async () => {
    if (!form.name.trim()) { showToast('Name is required', 'error'); return; }
    setSaving(true);
    try {
      const url = editingId ? `/app/api/client/${editingId}/update/` : '/app/api/client/create/';
      const body = { ...form };
      if (!body.password) delete body.password;
      const { data } = await apiPost(url, body);
      showToast(data?.success ? (data.message || 'Saved!') : (data?.message || 'Failed'), data?.success ? 'success' : 'error');
      if (data?.success) { setShowForm(false); loadClients(); }
    } catch (e) { showToast('Network error', 'error'); }
    setSaving(false);
  };

  const toggleClient = async (client) => {
    try {
      const { data } = await apiPost(`/app/api/client/${client.id}/toggle/`, {});
      showToast(data?.success ? (data.message || 'Toggled') : (data?.message || 'Failed'), data?.success ? 'success' : 'error');
      if (data?.success) loadClients();
    } catch (e) { showToast('Network error', 'error'); }
  };

  const deleteClient = (client) => {
    Alert.alert('Delete Client?', `Delete "${client.name}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          const { data } = await apiPost(`/app/api/client/${client.id}/delete/`, {});
          showToast(data?.success ? (data.message || 'Deleted') : (data?.message || 'Failed'), data?.success ? 'success' : 'error');
          if (data?.success) loadClients();
        } catch (e) { showToast('Network error', 'error'); }
      }},
    ]);
  };

  const renderItem = ({ item }) => (
    <View style={s.card}>
      <View style={s.cardTop}>
        <View style={s.avatar}><FontAwesome5 name="building" size={14} color="#3b82f6" /></View>
        <View style={s.cardInfo}>
          <Text style={s.name} numberOfLines={1}>{item.name}</Text>
          <Text style={s.email} numberOfLines={1}>{item.email || item.phone || 'No contact'}</Text>
        </View>
        <View style={[s.statusDot, { backgroundColor: item.is_active ? '#22c55e' : '#ef4444' }]} />
      </View>
      <View style={s.cardActions}>
        <View style={s.toggleRow}>
          <Text style={s.toggleLabel}>Active</Text>
          <Switch value={item.is_active} onValueChange={() => toggleClient(item)} trackColor={{ true: colors.brandLight }} thumbColor="#fff" />
        </View>
        <TouchableOpacity onPress={() => openEdit(item)} style={s.actionBtn}><FontAwesome5 name="pen" size={11} color={colors.brandLight} /></TouchableOpacity>
        <TouchableOpacity onPress={() => deleteClient(item)} style={s.actionBtn}><FontAwesome5 name="trash-alt" size={11} color="#ef4444" /></TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={s.root}>
      <TopBar title="Clients" subtitle="Manage client accounts" onBack={() => navigation.goBack()} rightAction={{ icon: 'plus', onPress: openCreate }} />

      {/* Search */}
      <View style={s.searchBar}>
        <FontAwesome5 name="search" size={12} color={colors.gray400} style={s.searchIcon} />
        <TextInput style={s.searchInput} value={search} onChangeText={setSearch} placeholder="Search clients..." placeholderTextColor={colors.gray300} />
      </View>

      {loading ? (
        <ListSkeleton rows={5} />
      ) : (
        <FlatList
          data={filtered}
          renderItem={renderItem}
          keyExtractor={item => item.id.toString()}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={<View style={s.empty}><View style={s.emptyIcon}><FontAwesome5 name="building" size={24} color={colors.gray300} /></View><Text style={s.emptyTitle}>{search ? 'No matching clients' : 'No clients found'}</Text></View>}
        />
      )}

      {/* Create/Edit Modal */}
      {showForm && (
        <View style={s.modalOverlay}>
          <TouchableOpacity style={s.modalBg} activeOpacity={1} onPress={() => setShowForm(false)} />
          <View style={s.modalSheet}>
            <View style={s.modalHandle} />
            <Text style={s.modalTitle}>{editingId ? 'Edit Client' : 'Add New Client'}</Text>
            <View style={s.formFields}>
              <FormField label="NAME" value={form.name} onChangeText={t => setForm(p => ({ ...p, name: t }))} placeholder="Client name" />
              <FormField label="EMAIL" value={form.email} onChangeText={t => setForm(p => ({ ...p, email: t }))} placeholder="email@example.com" keyboardType="email-address" />
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

function FormField({ label, value, onChangeText, placeholder, keyboardType, secureTextEntry }) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput style={s.fieldInput} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.gray300} keyboardType={keyboardType} secureTextEntry={secureTextEntry} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceBg },
  loadWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  searchBar: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 12, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', ...shadows.sm },
  searchIcon: { position: 'absolute', left: 14, zIndex: 1 },
  searchInput: { flex: 1, paddingLeft: 38, paddingRight: 14, paddingVertical: 11, fontSize: 13, color: colors.gray700 },
  list: { padding: 16, gap: 10, paddingBottom: 32 },
  card: { backgroundColor: '#fff', borderRadius: 20, borderWidth: 1, borderColor: '#e2e8f0', overflow: 'hidden', ...shadows.sm },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  avatar: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#dbeafe', alignItems: 'center', justifyContent: 'center' },
  cardInfo: { flex: 1, minWidth: 0 },
  name: { fontSize: 13, fontWeight: '700', color: colors.gray800 },
  email: { fontSize: 11, color: colors.gray400, marginTop: 1 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  cardActions: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingHorizontal: 14, paddingVertical: 8, gap: 8 },
  toggleRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  toggleLabel: { fontSize: 11, fontWeight: '600', color: colors.gray500 },
  actionBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.gray50, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyIcon: { width: 64, height: 64, borderRadius: 20, backgroundColor: colors.gray100, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: 13, fontWeight: '600', color: colors.gray400 },
  // Modal
  modalOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 70 },
  modalBg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)' },
  modalSheet: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 24, ...shadows.xl },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#e5e7eb', alignSelf: 'center', marginTop: 12, marginBottom: 8 },
  modalTitle: { fontSize: 16, fontWeight: '700', color: colors.gray800, paddingHorizontal: 16, marginBottom: 16 },
  formFields: { paddingHorizontal: 16, gap: 12 },
  field: {},
  fieldLabel: { fontSize: 10, fontWeight: '700', color: colors.gray500, letterSpacing: 0.8, marginBottom: 4 },
  fieldInput: { backgroundColor: colors.gray50, borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: colors.gray700 },
  formBtns: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginTop: 16 },
  cancelBtn: { flex: 1, paddingVertical: 14, backgroundColor: colors.gray100, borderRadius: 12, alignItems: 'center' },
  cancelBtnText: { fontSize: 12, fontWeight: '600', color: colors.gray600 },
  saveBtnWrap: { flex: 2, borderRadius: 12, overflow: 'hidden' },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, borderRadius: 12 },
  saveBtnText: { fontSize: 12, fontWeight: '700', color: '#fff' },
});
