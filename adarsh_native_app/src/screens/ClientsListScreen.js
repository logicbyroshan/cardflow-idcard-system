import React, { useState, useEffect, useMemo, useDeferredValue } from 'react';
import { View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet, ActivityIndicator, Switch, RefreshControl, Modal, ScrollView, Dimensions, Linking } from 'react-native';
import { IconSearch, IconFilter, IconPlus, IconTrash, IconEdit, IconUsers, IconList, IconClose, IconCheck, IconMail, IconPhone } from '../components/Icons';
import { LinearGradient } from 'expo-linear-gradient';
import TopBar from '../components/TopBar';
import Toast from '../components/Toast';
import { ListSkeleton } from '../components/Skeleton';
import { ErrorBanner } from '../components/NetworkGuard';
import ConfirmModal from '../components/ConfirmModal';
import { apiGet, apiPost } from '../api/client';
import { colors, gradients, shadows, radius, roleThemes, fontFamily } from '../theme';
import { useAuth } from '../context/AuthContext';
import useRefreshableResource from '../hooks/useRefreshableResource';

const { width } = Dimensions.get('window');

export default function ClientsListScreen({ navigation, route }) {
  const { user, startImpersonation } = useAuth();
  const [clients, setClients] = useState([]);
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

  const loadClients = async () => {
    const { ok, data } = await apiGet('/api/mobile/clients/');
    if (ok && data?.success) setClients(data.users || []);
    else throw new Error(data?.message || 'Failed to load clients');
  };

  const { loading, refreshing, error, refresh } = useRefreshableResource(loadClients, { initialData: [] });

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
    setForm({ name: '', email: '', phone: '', password: '' });
    setShowForm(true);
  };

  const openEdit = (client) => {
    setEditingId(client.id);
    setForm({ name: client.name || '', email: client.email || '', phone: client.phone || '', password: '' });
    setShowForm(true);
  };

  const saveClient = async () => {
    if (!form.name || !form.email || (!editingId && !form.password)) {
      showToast('Please fill required fields', 'error');
      return;
    }
    setSaving(true);
    try {
      const url = editingId ? `/api/mobile/client/${editingId}/update/` : '/api/mobile/client/create/';
      const { ok, data } = await apiPost(url, form);
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
      title: 'Switch to Client?',
      message: `Act as "${client.name}"? You can switch back anytime from the dashboard.`,
      icon: 'users',
      color: colors.brandPrimary,
      onConfirm: async () => {
        setConfirmModal(p => ({ ...p, visible: false }));
        setImpersonatingId(client.id);
        const result = await startImpersonation(client.id);
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
        <View style={s.cardInfo}>
          <Text style={s.cardName} numberOfLines={1}>{item.name}</Text>
          <View style={s.badgeGrid}>
            <StatPill label="P" count={item.counts.pending} color="#f59e0b" />
            <StatPill label="V" count={item.counts.verified} color="#10b981" />
            <StatPill label="A" count={item.counts.approved} color="#3b82f6" />
            <StatPill label="D" count={item.counts.download} color="#8b5cf6" />
          </View>
        </View>
        <TouchableOpacity activeOpacity={0.7} onPress={() => toggleClient(item)} style={[s.statusPill, { backgroundColor: item.is_active ? '#ecfdf5' : '#fef2f2' }]}>
          <View style={[s.statusDotSmall, { backgroundColor: item.is_active ? '#10b981' : '#ef4444' }]} />
          <Text style={[s.statusPillText, { color: item.is_active ? '#065f46' : '#991b1b' }]}>{item.is_active ? 'ACTIVE' : 'INACTIVE'}</Text>
        </TouchableOpacity>
      </View>
      <View style={s.cardActions}>
        <TouchableOpacity style={s.actionBtn} onPress={() => handleImpersonate(item)} disabled={impersonatingId === item.id}>
          <LinearGradient colors={['#eff6ff', '#dbeafe']} style={s.actionBtnInner}>
            {impersonatingId === item.id ? <ActivityIndicator size="small" color="#3b82f6" /> : <><IconUsers size={12} color="#3b82f6" /><Text style={[s.actionBtnText, { color: '#3b82f6' }]}>SWITCH</Text></>}
          </LinearGradient>
        </TouchableOpacity>
        <TouchableOpacity style={s.actionBtn} onPress={() => openEdit(item)}>
          <LinearGradient colors={['#f8fafc', '#f1f5f9']} style={s.actionBtnInner}>
            <IconEdit size={12} color={colors.gray600} /><Text style={[s.actionBtnText, { color: colors.gray600 }]}>EDIT</Text>
          </LinearGradient>
        </TouchableOpacity>
        <TouchableOpacity style={s.actionBtn} onPress={() => deleteClient(item)}>
          <LinearGradient colors={['#fef2f2', '#fee2e2']} style={s.actionBtnInner}>
            <IconTrash size={12} color="#ef4444" /><Text style={[s.actionBtnText, { color: '#ef4444' }]}>DEL</Text>
          </LinearGradient>
        </TouchableOpacity>
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
        <TouchableOpacity style={s.addBtn} onPress={openCreate}>
          <LinearGradient colors={gradients.brand} style={s.addBtnInner}><IconPlus size={16} color="#fff" /></LinearGradient>
        </TouchableOpacity>
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
              {!editingId && <FormField label="PASSWORD *" value={form.password} onChangeText={t => setForm(f => ({ ...f, password: t }))} secureTextEntry />}
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
    <View style={[s.statPill, { borderColor: color + '30', backgroundColor: color + '08' }]}>
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
  searchSection: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginVertical: 12 },
  searchBar: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: radius.sm, paddingHorizontal: 12, height: 44, ...shadows.sm, borderWidth: 1, borderColor: colors.gray100 },
  searchInput: { flex: 1, marginLeft: 8, fontSize: 13, fontFamily: fontFamily.medium, color: colors.gray800 },
  addBtn: { width: 44, height: 44, borderRadius: radius.sm, ...shadows.md },
  addBtnInner: { flex: 1, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 12, paddingBottom: 100 },
  card: { backgroundColor: '#fff', borderRadius: radius.sm, padding: 12, marginBottom: 12, ...shadows.sm, borderWidth: 1, borderColor: colors.gray100 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start' },
  cardInfo: { flex: 1 },
  cardName: { fontSize: 14, fontFamily: fontFamily.bold, color: colors.gray800, marginBottom: 8 },
  badgeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  statPill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 1, minWidth: 44, justifyContent: 'space-between' },
  statLabel: { fontSize: 7, fontFamily: fontFamily.bold, opacity: 0.8 },
  statCount: { fontSize: 10, fontFamily: fontFamily.bold, marginLeft: 4 },
  statusPill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.xs },
  statusDotSmall: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  statusPillText: { fontSize: 8, fontFamily: fontFamily.bold },
  cardActions: { flexDirection: 'row', gap: 10, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  actionBtn: { flex: 1, height: 32, borderRadius: radius.xs },
  actionBtnInner: { flex: 1, borderRadius: radius.xs, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  actionBtnText: { fontSize: 9, fontFamily: fontFamily.bold },
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalBg: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  modalContent: { backgroundColor: '#fff', borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: 20, maxHeight: '90%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 16, fontFamily: fontFamily.bold, color: colors.gray800 },
  field: { marginBottom: 16 },
  fieldLabel: { fontSize: 11, fontFamily: fontFamily.bold, color: colors.gray500, marginBottom: 6 },
  fieldInput: { backgroundColor: colors.gray50, borderRadius: radius.sm, paddingHorizontal: 12, height: 44, fontSize: 13, fontFamily: fontFamily.medium, color: colors.gray800, borderWidth: 1, borderColor: colors.gray100 },
  modalFooter: { flexDirection: 'row', gap: 12, marginTop: 10, paddingTop: 10 },
  modalCancel: { flex: 1, height: 44, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.gray100 },
  modalCancelText: { fontSize: 13, fontFamily: fontFamily.bold, color: colors.gray600 },
  modalSave: { flex: 2, height: 44, borderRadius: radius.sm },
  modalSaveBtn: { flex: 1, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  modalSaveText: { fontSize: 13, fontFamily: fontFamily.bold, color: '#fff' },
  empty: { padding: 60, alignItems: 'center' },
  emptyText: { fontSize: 13, fontFamily: fontFamily.medium, color: colors.gray400 },
});
