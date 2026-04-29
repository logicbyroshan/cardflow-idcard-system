import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet, ActivityIndicator, Alert, Switch, RefreshControl } from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import TopBar from '../components/TopBar';
import Toast from '../components/Toast';
import { ListSkeleton } from '../components/Skeleton';
import { ErrorBanner } from '../components/NetworkGuard';
import { apiGet, apiPost } from '../api/client';
import { colors, gradients, shadows, spacing, radius, typography } from '../theme';

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

  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const loadClients = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const { ok, data } = await apiGet('/app/api/impersonate/users/');
      if (ok && data?.success) {
        const cl = (data.data || data.users || []).map(c => ({
          id: c.id, name: c.name || c.full_name || '', email: c.email || '',
          phone: c.phone || '', is_active: c.is_active !== false, role: c.role || '',
        }));
        setClients(cl);
        setFiltered(cl);
      } else {
        setError(data?.message || 'Failed to load clients');
      }
    } catch (e) {
      setError('Network error - check your connection');
    }
    setLoading(false);
    setRefreshing(false);
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
        <View style={s.avatar}><FontAwesome5 name="building" size={16} color={colors.brandPrimary} /></View>
        <View style={s.cardInfo}>
          <Text style={s.name} numberOfLines={1}>{item.name}</Text>
          <Text style={s.email} numberOfLines={1}>{item.email || item.phone || 'No contact'}</Text>
        </View>
        <View style={[s.statusDot, { backgroundColor: item.is_active ? '#22c55e' : '#ef4444' }]} />
      </View>
      <View style={s.cardActions}>
        <View style={s.toggleRow}>
          <Text style={s.toggleLabel}>Active</Text>
          <Switch 
            value={item.is_active} 
            onValueChange={() => toggleClient(item)} 
            trackColor={{ true: colors.brandPrimary }} 
            thumbColor="#fff" 
            style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
          />
        </View>
        <View style={s.btnGroup}>
          <TouchableOpacity onPress={() => openEdit(item)} style={s.actionBtn}><FontAwesome5 name="pen" size={12} color={colors.brandPrimary} /></TouchableOpacity>
          <TouchableOpacity onPress={() => deleteClient(item)} style={s.actionBtn}><FontAwesome5 name="trash-alt" size={12} color="#ef4444" /></TouchableOpacity>
        </View>
      </View>
    </View>
  );

  return (
    <View style={s.root}>
      <TopBar title="Clients" subtitle="Manage client accounts" onBack={() => navigation.goBack()} rightAction={{ icon: 'plus', onPress: openCreate }} />

      <View style={s.searchBarContainer}>
        <View style={s.searchBar}>
          <FontAwesome5 name="search" size={14} color={colors.gray400} style={s.searchIcon} />
          <TextInput style={s.searchInput} value={search} onChangeText={setSearch} placeholder="Search clients..." placeholderTextColor={colors.gray400} />
        </View>
      </View>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} onRetry={() => loadClients(true)} />}
      {loading ? (
        <ListSkeleton rows={6} />
      ) : (
        <FlatList
          data={filtered}
          renderItem={renderItem}
          keyExtractor={item => item.id.toString()}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadClients(true)} tintColor={colors.brandPrimary} />}
          ListEmptyComponent={
            <View style={s.empty}>
              <View style={s.emptyIcon}><FontAwesome5 name="building" size={32} color={colors.gray200} /></View>
              <Text style={s.emptyTitle}>{search ? 'No matching clients' : 'No clients found'}</Text>
            </View>
          }
        />
      )}

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
                <LinearGradient colors={gradients.brand} start={{x:0, y:0}} end={{x:1, y:0}} style={s.saveBtn}>
                  {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.saveBtnText}>{editingId ? 'Update Client' : 'Create Client'}</Text>}
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
      <TextInput style={s.fieldInput} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.gray400} keyboardType={keyboardType} secureTextEntry={secureTextEntry} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceBg },
  searchBarContainer: { paddingHorizontal: 20, marginTop: 16, marginBottom: 8 },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#f1f5f9', ...shadows.sm },
  searchIcon: { position: 'absolute', left: 16, zIndex: 1 },
  searchInput: { flex: 1, paddingLeft: 44, paddingRight: 16, paddingVertical: 14, fontSize: 14, color: colors.gray700, fontFamily: 'SairaSemiCondensed-Medium' },
  
  list: { padding: 20, gap: 12, paddingBottom: 40 },
  card: { backgroundColor: '#fff', borderRadius: 24, borderWidth: 1, borderColor: '#f1f5f9', overflow: 'hidden', ...shadows.md },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16 },
  avatar: { width: 48, height: 48, borderRadius: 14, backgroundColor: '#eff6ff', alignItems: 'center', justifyContent: 'center' },
  cardInfo: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, fontWeight: '700', color: colors.gray800, fontFamily: 'SairaSemiCondensed-Bold' },
  email: { fontSize: 12, color: colors.gray400, marginTop: 2, fontFamily: 'SairaSemiCondensed-Medium' },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  
  cardActions: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#f8fafc', paddingHorizontal: 16, paddingVertical: 10, gap: 12 },
  toggleRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  toggleLabel: { fontSize: 12, fontWeight: '600', color: colors.gray500, fontFamily: 'SairaSemiCondensed-Medium' },
  btnGroup: { flexDirection: 'row', gap: 8 },
  actionBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#f8fafc', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#f1f5f9' },
  
  empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 40 },
  emptyIcon: { width: 80, height: 80, borderRadius: 24, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginBottom: 20, ...shadows.sm },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: colors.gray400, fontFamily: 'SairaSemiCondensed-Bold', textAlign: 'center' },
  
  modalOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100 },
  modalBg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' },
  modalSheet: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#fff', borderTopLeftRadius: 32, borderTopRightRadius: 32, paddingBottom: 40, ...shadows.xl },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#e2e8f0', alignSelf: 'center', marginTop: 14, marginBottom: 12 },
  modalTitle: { fontSize: 20, fontWeight: '800', color: colors.gray800, paddingHorizontal: 24, marginBottom: 24, fontFamily: 'SairaSemiCondensed-Bold' },
  formFields: { paddingHorizontal: 24, gap: 16 },
  field: {},
  fieldLabel: { fontSize: 11, fontWeight: '800', color: colors.gray400, letterSpacing: 1.5, marginBottom: 8, fontFamily: 'SairaSemiCondensed-Bold' },
  fieldInput: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#f1f5f9', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, fontSize: 14, color: colors.gray800, fontFamily: 'SairaSemiCondensed-Medium' },
  
  formBtns: { flexDirection: 'row', gap: 12, paddingHorizontal: 24, marginTop: 32 },
  cancelBtn: { flex: 1, paddingVertical: 16, backgroundColor: '#f1f5f9', borderRadius: 16, alignItems: 'center' },
  cancelBtnText: { fontSize: 14, fontWeight: '700', color: colors.gray600, fontFamily: 'SairaSemiCondensed-Bold' },
  saveBtnWrap: { flex: 2, borderRadius: 16, overflow: 'hidden', ...shadows.md },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16 },
  saveBtnText: { fontSize: 14, fontWeight: '800', color: '#fff', fontFamily: 'SairaSemiCondensed-Bold' },
});
