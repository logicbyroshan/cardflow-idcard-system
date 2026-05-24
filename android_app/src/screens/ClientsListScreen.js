import React, { useState, useEffect, useMemo, useDeferredValue, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet, ActivityIndicator, Switch, RefreshControl, Modal, ScrollView, Dimensions, Linking, Image } from 'react-native';
import { IconSearch, IconFilter, IconPlus, IconTrash, IconEdit, IconUsers, IconList, IconClose, IconCheck, IconMail, IconPhone, DynamicIcon } from '../components/Icons';
import { LinearGradient } from 'expo-linear-gradient';
import TopBar from '../components/TopBar';
import Toast from '../components/Toast';
import { ListSkeleton } from '../components/Skeleton';
import { ErrorBanner } from '../components/NetworkGuard';
import ConfirmModal from '../components/ConfirmModal';
import { apiGet, apiPost, BASE_URL, getSessionCookies, resolveAdarshImageUrl } from '../api/client';
import { colors, gradients, shadows, radius, roleThemes, fontFamily } from '../theme';
import { useAuth } from '../context/AuthContext';
import useRefreshableResource from '../hooks/useRefreshableResource';

const { width } = Dimensions.get('window');

export default function ClientsListScreen({ navigation, route }) {
  const { user, startImpersonation } = useAuth();
  const perms = useMemo(() => ({
    ...(user?.permissions || {}),
    isSuperAdmin: !!(user?.isSuperAdmin || user?.role === 'super_admin' || user?.role === 'admin'),
  }), [user]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); 
  const deferredSearch = useDeferredValue(search);
  
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '' });
  const [saving, setSaving] = useState(false);

  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });
  const [impersonatingId, setImpersonatingId] = useState(null);
  const [confirmModal, setConfirmModal] = useState({ 
    visible: false, title: '', message: '', icon: '', color: colors.brandPrimary, onConfirm: null 
  });

  const showToast = (msg, type = 'info') => setToast({ visible: true, message: msg, type });

  const loadClients = useCallback(async () => {
    const { ok, data } = await apiGet('/api/mobile/clients/');
    if (ok && data?.success) return data.users || [];
    throw new Error(data?.message || 'Failed to load clients');
  }, []);

  const { data: clients = [], loading, refreshing, error, refresh } = useRefreshableResource(loadClients, { initialData: [] });

  useEffect(() => {
    if (route.params?.openForm) openCreate();
  }, [route.params]);

  const filtered = useMemo(() => {
    return clients.filter(c => {
      const name = (c.name || '').toLowerCase();
      const email = (c.email || '').toLowerCase();
      const q = deferredSearch.toLowerCase();
      const matchesSearch = !q || name.includes(q) || email.includes(q);
      const matchesStatus = statusFilter === 'all' || (statusFilter === 'active' && c.is_active) || (statusFilter === 'inactive' && !c.is_active);
      return matchesSearch && matchesStatus;
    });
  }, [deferredSearch, statusFilter, clients]);

  const openCreate = () => {
    setEditingId(null);
    setForm({ name: '', email: '', phone: '', password: '', is_active: true });
    setShowForm(true);
  };

  const openEdit = (client) => {
    setEditingId(client.id);
    setForm({ 
      name: client.name || '', 
      email: client.email || '', 
      phone: client.phone || '', 
      password: '', 
      is_active: client.is_active ?? true 
    });
    setShowForm(true);
  };

  const saveClient = async () => {
    if (!form.name || !form.email) {
      showToast('Please fill required fields (Name & Email)', 'error');
      return;
    }
    setSaving(true);
    try {
      const url = editingId ? `/api/mobile/client/${editingId}/update/` : '/api/mobile/client/create/';
      const payload = {
        name: form.name,
        email: form.email,
        phone: form.phone,
        is_active: form.is_active,
      };
      if (form.password) {
        if (editingId) {
          payload.temp_password = form.password;
        } else {
          payload.password = form.password;
        }
      }
      const { ok, data } = await apiPost(url, payload);
      if (ok && data.success) {
        showToast(editingId ? 'Client updated' : 'Client created', 'success');
        setShowForm(false);
        refresh();
      } else showToast(data.message || 'Error saving client', 'error');
    } catch (e) { showToast('Network error', 'error'); }
    setSaving(false);
  };

  const toggleClient = (client) => {
    setConfirmModal({
      visible: true,
      title: client.is_active ? 'Deactivate Client?' : 'Activate Client?',
      message: `Are you sure you want to ${client.is_active ? 'deactivate' : 'activate'} "${client.name}"?`,
      icon: 'user-check',
      color: client.is_active ? '#ef4444' : '#22c55e',
      onConfirm: async () => {
        setConfirmModal(p => ({ ...p, visible: false }));
        try {
          const { ok, data } = await apiPost(`/api/mobile/client/${client.id}/toggle/`, {});
          if (ok && data.success) { showToast(data.message, 'success'); refresh(); }
          else showToast(data.message || 'Error toggling client', 'error');
        } catch (e) { showToast('Network error', 'error'); }
      }
    });
  };

  const deleteClient = (client) => {
    setConfirmModal({
      visible: true,
      title: 'Delete Client?',
      message: `This will permanently delete "${client.name}". This action cannot be undone.`,
      icon: 'trash',
      color: '#ef4444',
      onConfirm: async () => {
        setConfirmModal(p => ({ ...p, visible: false }));
        try {
          const { ok, data } = await apiPost(`/api/mobile/client/${client.id}/delete/`, {});
          if (ok && data.success) { showToast(data.message, 'success'); refresh(); }
          else showToast(data.message || 'Error deleting client', 'error');
        } catch (e) { showToast('Network error', 'error'); }
      }
    });
  };

  const handleImpersonate = (client) => {
    setConfirmModal({
      visible: true,
      title: 'Impersonate Client?',
      message: `Act as "${client.name}"? You can switch back anytime from the dashboard.`,
      icon: 'users',
      color: colors.brandPrimary,
      onConfirm: async () => {
        setConfirmModal(p => ({ ...p, visible: false }));
        setImpersonatingId(client.user_id || client.id);
        const result = await startImpersonation(client.user_id || client.id);
        setImpersonatingId(null);
        if (result.success) {
          showToast('Switched to ' + client.name, 'success');
          navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
        } else showToast(result.message || 'Failed to switch', 'error');
      }
    });
  };

  const renderItem = ({ item }) => (
    <View style={s.card}>
      <View style={s.cardTop}>
        <View style={s.logoCircle}>
          {item.logo_url ? (
            <Image 
              source={{ 
                uri: resolveAdarshImageUrl(item.logo_url),
                headers: {
                  Cookie: getSessionCookies()
                }
              }} 
              style={s.logo} 
            />
          ) : (
            <Text style={s.logoText}>{(item.name || 'C').charAt(0).toUpperCase()}</Text>
          )}
        </View>
        <View style={s.cardInfo}>
          <Text style={s.cardName} numberOfLines={1}>{item.name}</Text>
          <View style={s.contactRow}>
            <IconMail size={10} color={colors.gray400} />
            <Text style={s.contactText} numberOfLines={1}>{item.email}</Text>
          </View>
          {item.phone && (
            <View style={[s.contactRow, { marginTop: 2 }]}>
              <IconPhone size={10} color={colors.gray400} />
              <Text style={s.contactText} numberOfLines={1}>{item.phone}</Text>
            </View>
          )}
        </View>
        <TouchableOpacity 
          activeOpacity={(perms.isSuperAdmin || perms.perm_idcard_client_list) ? 0.7 : 1} 
          disabled={!(perms.isSuperAdmin || perms.perm_idcard_client_list)}
          onPress={() => toggleClient(item)} 
          style={[s.statusPill, { backgroundColor: item.is_active ? '#ecfdf5' : '#fef2f2' }]}
        >
          <View style={[s.statusDotSmall, { backgroundColor: item.is_active ? '#10b981' : '#ef4444' }]} />
          <Text style={[s.statusPillText, { color: item.is_active ? '#065f46' : '#991b1b' }]}>{item.is_active ? 'ACTIVE' : 'INACTIVE'}</Text>
        </TouchableOpacity>
      </View>
      
      <View style={s.cardStats}>
        <StatPill label="PENDING" count={item.counts?.pending} color="#f59e0b" />
        <StatPill label="VERIFIED" count={item.counts?.verified} color="#10b981" />
        <StatPill label="APPROVED" count={item.counts?.approved} color="#3b82f6" />
        <StatPill label="DOWNLOAD" count={item.counts?.download} color="#8b5cf6" />
        <StatPill label="POOL" count={item.counts?.pool} color="#ec4899" />
      </View>

      <View style={s.cardActions}>
        {(perms.isSuperAdmin || perms.perm_idcard_client_list) && (
          <TouchableOpacity style={s.actionBtn} onPress={() => handleImpersonate(item)} disabled={impersonatingId === (item.user_id || item.id)}>
            <LinearGradient colors={['#eff6ff', '#dbeafe']} style={s.actionBtnInner}>
              {impersonatingId === (item.user_id || item.id) ? <ActivityIndicator size="small" color="#3b82f6" /> : <><DynamicIcon name="users" size={12} color="#3b82f6" style={s.actionIcon} /><Text style={[s.actionBtnText, { color: '#3b82f6' }]}>IMPERSONATE</Text></>}
            </LinearGradient>
          </TouchableOpacity>
        )}
        {(perms.isSuperAdmin || perms.perm_idcard_client_list) && (
          <TouchableOpacity style={s.actionBtn} onPress={() => openEdit(item)}>
            <LinearGradient colors={['#f8fafc', '#f1f5f9']} style={s.actionBtnInner}>
              <DynamicIcon name="edit" size={12} color={colors.gray600} style={s.actionIcon} /><Text style={[s.actionBtnText, { color: colors.gray600 }]}>EDIT</Text>
            </LinearGradient>
          </TouchableOpacity>
        )}
        {perms.isSuperAdmin && (
          <TouchableOpacity style={s.actionBtn} onPress={() => deleteClient(item)}>
            <LinearGradient colors={['#fef2f2', '#fee2e2']} style={s.actionBtnInner}>
              <DynamicIcon name="trash" size={12} color="#ef4444" style={s.actionIcon} /><Text style={[s.actionBtnText, { color: '#ef4444' }]}>DEL</Text>
            </LinearGradient>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  return (
    <View style={s.root}>
      <TopBar title="CLIENTS" onBack={() => navigation.goBack()} />
      <View style={s.searchSection}>
        <View style={s.searchBar}>
          <IconSearch size={14} color={colors.gray400} />
          <TextInput style={s.searchInput} value={search} onChangeText={setSearch} placeholder="Search clients..." placeholderTextColor={colors.gray400} />
        </View>
        {(perms.isSuperAdmin || perms.perm_idcard_client_list) && (
          <TouchableOpacity style={s.addBtn} onPress={openCreate}>
            <LinearGradient colors={gradients.brand} style={s.addBtnInner}><IconPlus size={16} color="#fff" /></LinearGradient>
          </TouchableOpacity>
        )}
      </View>

      {error ? <ErrorBanner message={error} onRetry={refresh} /> : loading && !refreshing ? <ListSkeleton count={6} /> : (
        <FlatList data={filtered} renderItem={renderItem} keyExtractor={item => item.id.toString()} contentContainerStyle={s.list} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.brandPrimary} />} ListEmptyComponent={<View style={s.empty}><Text style={s.emptyText}>No clients found</Text></View>} />
      )}

      <Modal visible={showForm} animationType="fade" transparent onRequestClose={() => setShowForm(false)}>
        <View style={s.modalOverlay}>
          <TouchableOpacity style={s.modalBg} activeOpacity={1} onPress={() => setShowForm(false)} />
          <View style={s.modalContent}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>{editingId ? 'Update Client' : 'New Client'}</Text>
              <TouchableOpacity onPress={() => setShowForm(false)}><IconClose size={20} color={colors.gray400} /></TouchableOpacity>
            </View>
            <ScrollView>
              <FormField label="CLIENT NAME *" value={form.name} onChangeText={t => setForm(f => ({ ...f, name: t }))} />
              <FormField label="EMAIL *" value={form.email} onChangeText={t => setForm(f => ({ ...f, email: t }))} keyboardType="email-address" />
              <FormField label="PHONE" value={form.phone} onChangeText={t => setForm(f => ({ ...f, phone: t }))} keyboardType="phone-pad" />
              <FormField 
                label={editingId ? "TEMP PASSWORD (OPTIONAL)" : "PASSWORD (OPTIONAL)"} 
                value={form.password} 
                onChangeText={t => setForm(f => ({ ...f, password: t }))} 
                secureTextEntry 
              />
              <View style={s.switchRow}>
                <Text style={s.switchLabel}>ACTIVE STATUS</Text>
                <Switch 
                  value={form.is_active} 
                  onValueChange={v => setForm(f => ({ ...f, is_active: v }))} 
                  trackColor={{ false: '#e2e8f0', true: colors.brandPrimary }}
                  thumbColor={form.is_active ? '#fff' : '#f4f3f4'}
                />
              </View>
            </ScrollView>
            <View style={s.modalFooter}>
              <TouchableOpacity style={s.modalCancel} onPress={() => setShowForm(false)}><Text style={s.modalCancelText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={s.modalSave} onPress={saveClient} disabled={saving}>
                <LinearGradient colors={gradients.brand} style={s.modalSaveBtn}>
                  {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.modalSaveText}>{editingId ? 'UPDATE' : 'CREATE'}</Text>}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <ConfirmModal visible={confirmModal.visible} onClose={() => setConfirmModal(p => ({ ...p, visible: false }))} onConfirm={confirmModal.onConfirm} title={confirmModal.title} message={confirmModal.message} icon={confirmModal.icon} confirmColor={confirmModal.color} />
      <Toast visible={toast.visible} message={toast.message} type={toast.type} onHide={() => setToast(p => ({ ...p, visible: false }))} />
    </View>
  );
}

function StatPill({ label, count, color }) {
  return (
    <View style={[s.statPill, { borderColor: color + '20', backgroundColor: color + '05' }]}>
      <Text style={[s.statLabel, { color }]}>{label}</Text>
      <Text style={[s.statCount, { color }]}>{count || 0}</Text>
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
  searchSection: { flexDirection: 'row', paddingHorizontal: 16, marginVertical: 12 },
  searchBar: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: radius.xs, paddingHorizontal: 12, height: 44, ...shadows.sm, borderWidth: 1, borderColor: colors.gray100, marginRight: 10 },
  searchInput: { flex: 1, marginLeft: 8, fontSize: 13, fontFamily: 'SairaSemiCondensed-Medium', color: colors.gray800 },
  addBtn: { width: 44, height: 44, borderRadius: radius.xs, ...shadows.md },
  addBtnInner: { flex: 1, borderRadius: radius.xs, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: 12, paddingVertical: 8, paddingBottom: 100 },
  card: { backgroundColor: '#fff', borderRadius: radius.sm, padding: 14, marginBottom: 16, ...shadows.sm, borderWidth: 1, borderColor: colors.gray100 },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  logoCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.gray50, alignItems: 'center', justifyContent: 'center', marginRight: 14, borderWidth: 1, borderColor: '#f1f5f9', overflow: 'hidden' },
  logo: { width: '100%', height: '100%', resizeMode: 'cover' },
  logoText: { fontSize: 18, fontFamily: 'SairaSemiCondensed-Bold', color: colors.brandPrimary },
  cardInfo: { flex: 1 },
  cardName: { fontSize: 15, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray800, marginBottom: 4 },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  contactText: { fontSize: 11, fontFamily: 'SairaSemiCondensed-Medium', color: colors.gray400 },
  cardStats: { flexDirection: 'row', gap: 8, marginTop: 14, flexWrap: 'wrap' },
  statPill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.xs, borderWidth: 1, minWidth: 60, justifyContent: 'space-between' },
  statLabel: { fontSize: 7, fontFamily: 'SairaSemiCondensed-Bold', letterSpacing: 0.5 },
  statCount: { fontSize: 11, fontFamily: 'SairaSemiCondensed-Bold', marginLeft: 6 },
  statusPill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.xs },
  statusDotSmall: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  statusPillText: { fontSize: 9, fontFamily: 'SairaSemiCondensed-Bold' },
  cardActions: { flexDirection: 'row', gap: 10, marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  actionBtn: { flex: 1, height: 36, borderRadius: radius.xs },
  actionBtnInner: { flex: 1, borderRadius: radius.xs, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  actionIcon: { marginRight: 8 },
  actionBtnText: { fontSize: 10, fontFamily: 'SairaSemiCondensed-Bold' },
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalBg: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  modalContent: { backgroundColor: '#fff', borderTopLeftRadius: radius.sm, borderTopRightRadius: radius.sm, padding: 20, maxHeight: '90%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 16, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray800 },
  field: { marginBottom: 16 },
  fieldLabel: { fontSize: 11, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray500, marginBottom: 6 },
  fieldInput: { backgroundColor: colors.gray50, borderRadius: radius.xs, paddingHorizontal: 12, height: 44, fontSize: 13, fontFamily: 'SairaSemiCondensed-Medium', color: colors.gray800, borderWidth: 1, borderColor: colors.gray100 },
  modalFooter: { flexDirection: 'row', gap: 12, marginTop: 10, paddingTop: 10 },
  modalCancel: { flex: 1, height: 44, borderRadius: radius.xs, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.gray100 },
  modalCancelText: { fontSize: 13, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray600 },
  modalSave: { flex: 2, height: 44, borderRadius: radius.xs },
  modalSaveBtn: { flex: 1, borderRadius: radius.xs, alignItems: 'center', justifyContent: 'center' },
  modalSaveText: { fontSize: 13, fontFamily: 'SairaSemiCondensed-Bold', color: '#fff' },
  empty: { padding: 60, alignItems: 'center' },
  emptyText: { fontSize: 13, fontFamily: 'SairaSemiCondensed-Medium', color: colors.gray400 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, paddingHorizontal: 2, paddingVertical: 8 },
  switchLabel: { fontSize: 11, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray500 },
});
