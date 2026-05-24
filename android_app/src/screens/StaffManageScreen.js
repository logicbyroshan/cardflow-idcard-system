import React, { useState, useMemo, useCallback, useDeferredValue, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet, ActivityIndicator, RefreshControl, Modal, ScrollView, Dimensions } from 'react-native';
import { IconSearch, IconFilter, IconPlus, IconTrash, IconEdit, IconClose, IconCheck, IconMail, IconPhone } from '../components/Icons';
import { LinearGradient } from 'expo-linear-gradient';
import TopBar from '../components/TopBar';
import Toast from '../components/Toast';
import { ListSkeleton } from '../components/Skeleton';
import { ErrorBanner } from '../components/NetworkGuard';
import ConfirmModal from '../components/ConfirmModal';
import { apiGet, apiPost } from '../api/client';
import { colors, gradients, shadows, radius, fontFamily } from '../theme';
import { useAuth } from '../context/AuthContext';
import useRefreshableResource from '../hooks/useRefreshableResource';

const { width } = Dimensions.get('window');

export default function StaffManageScreen({ navigation, route }) {
  const { user } = useAuth();
  const [staff, setStaff] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); 
  const deferredSearch = useDeferredValue(search);
  
  const targetRole = route.params?.role || 'client_staff';
  const isOperatorMode = targetRole === 'admin_staff';
  const pageTitle = isOperatorMode ? 'OPERATORS' : 'ASSISTANTS';
  const perms = useMemo(() => {
    const isSuper = !!(user?.isSuperAdmin || user?.role === 'super_admin' || user?.role === 'admin');
    const canManage = isOperatorMode 
      ? isSuper
      : (isSuper || user?.role === 'admin_staff' || (user?.permissions?.perm_manage_client_staff));
      
    return {
      canManage,
      isSuper,
    };
  }, [user, isOperatorMode]);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', phone: '', password: '', department: '', designation: '' });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });

  const [showAssign, setShowAssign] = useState(false);
  const [assigningId, setAssigningId] = useState(null);
  const [assignData, setAssignData] = useState({ groups: [], tables: [], clients: [] });
  const [selectedGroupIds, setSelectedGroupIds] = useState([]);
  const [selectedTableIds, setSelectedTableIds] = useState([]);
  const [selectedClientIds, setSelectedClientIds] = useState([]);
  const [loadingAssign, setLoadingAssign] = useState(false);
  const [savingAssign, setSavingAssign] = useState(false);

  const [confirmModal, setConfirmModal] = useState({ 
    visible: false, title: '', message: '', icon: '', color: colors.brandPrimary, onConfirm: null 
  });

  const showToast = (msg, type = 'info') => setToast({ visible: true, message: msg, type });

  const loadStaff = useCallback(async () => {
    const { ok, data } = await apiGet(`/api/mobile/staff/?role=${targetRole}`);
    if (ok && data?.success) setStaff(data.data?.staff || []);
    else throw new Error(data?.message || 'Failed to load staff');
  }, [targetRole]);

  const { loading, refreshing, error, refresh } = useRefreshableResource(loadStaff, { initialData: [] });
  
  useEffect(() => {
    if (route.params?.openForm) openCreate();
  }, [route.params]);

  const filtered = useMemo(() => {
    return staff.filter(s => {
      const name = (s.name || '').toLowerCase();
      const email = (s.email || '').toLowerCase();
      const q = deferredSearch.toLowerCase();
      const matchesSearch = !q || name.includes(q) || email.includes(q);
      const matchesStatus = statusFilter === 'all' || (statusFilter === 'active' && s.is_active) || (statusFilter === 'inactive' && !s.is_active);
      return matchesSearch && matchesStatus;
    });
  }, [deferredSearch, statusFilter, staff]);

  const openCreate = () => {
    setEditingId(null);
    setForm({ first_name: '', last_name: '', email: '', phone: '', password: '', department: '', designation: '' });
    setShowForm(true);
  };

  const openEdit = (member) => {
    setEditingId(member.id);
    const nameParts = (member.name || '').split(' ');
    setForm({ first_name: nameParts[0] || '', last_name: nameParts.slice(1).join(' ') || '', email: member.email || '', phone: member.phone || '', password: '', department: member.department || '', designation: member.designation || '' });
    setShowForm(true);
  };

  const saveStaff = async () => {
    if (!form.first_name || !form.email || (!editingId && !form.password)) {
      showToast('Please fill required fields', 'error'); return;
    }
    setSaving(true);
    try {
      const url = editingId ? `/api/mobile/staff/${editingId}/update/` : '/api/mobile/staff/create/';
      const { ok, data } = await apiPost(url, { ...form, role: targetRole });
      if (ok && data.success) { showToast(editingId ? 'Staff updated' : 'Staff created', 'success'); setShowForm(false); refresh(); }
      else showToast(data.message || 'Error saving staff', 'error');
    } catch (e) { showToast('Network error', 'error'); }
    setSaving(false);
  };

  const openAssign = async (member) => {
    setAssigningId(member.id);
    setLoadingAssign(true);
    setShowAssign(true);
    try {
      const { ok, data } = await apiGet(`/api/mobile/staff/${member.id}/assignment/`);
      if (ok && data.success) {
        setAssignData(data.data);
        setSelectedGroupIds(data.data.assigned_groups || []);
        setSelectedTableIds(data.data.assigned_tables || []);
        setSelectedClientIds(data.data.assigned_clients || []);
      }
    } catch (e) { showToast('Error loading assignments', 'error'); }
    setLoadingAssign(false);
  };

  const saveAssignment = async () => {
    setSavingAssign(true);
    try {
      const { ok, data } = await apiPost(`/api/mobile/staff/${assigningId}/assignment/update/`, {
        group_ids: selectedGroupIds, table_ids: selectedTableIds, client_ids: selectedClientIds
      });
      if (ok && data.success) { showToast('Assignments updated', 'success'); setShowAssign(false); }
      else showToast(data.message || 'Error saving', 'error');
    } catch (e) { showToast('Network error', 'error'); }
    setSavingAssign(false);
  };

  const toggleStatus = (member) => {
    setConfirmModal({
      visible: true, title: member.is_active ? 'Deactivate?' : 'Activate?', message: `Sure you want to ${member.is_active ? 'deactivate' : 'activate'} "${member.name}"?`, icon: 'user-check', color: member.is_active ? '#ef4444' : '#22c55e',
      onConfirm: async () => {
        setConfirmModal(p => ({ ...p, visible: false }));
        try {
          const { ok, data } = await apiPost(`/api/mobile/staff/${member.id}/toggle/`, {});
          if (ok && data.success) { showToast(data.message, 'success'); refresh(); }
          else showToast(data.message || 'Error toggling', 'error');
        } catch (e) { showToast('Network error', 'error'); }
      }
    });
  };

  const deleteStaff = (member) => {
    setConfirmModal({
      visible: true, title: 'Delete Staff?', message: `Permanently delete "${member.name}"?`, icon: 'trash', color: '#ef4444',
      onConfirm: async () => {
        setConfirmModal(p => ({ ...p, visible: false }));
        try {
          const { ok, data } = await apiPost(`/api/mobile/staff/${member.id}/delete/`, {});
          if (ok && data.success) { showToast(data.message, 'success'); refresh(); }
          else showToast(data.message || 'Error deleting', 'error');
        } catch (e) { showToast('Network error', 'error'); }
      }
    });
  };

  const renderItem = ({ item }) => (
    <View style={s.card}>
      <View style={s.cardTop}>
        <View style={s.cardAvatar}><Text style={s.avatarText}>{(item.name || 'S').charAt(0).toUpperCase()}</Text></View>
        <View style={s.cardInfo}>
          <Text style={s.cardName} numberOfLines={1}>{item.name}</Text>
          <Text style={s.cardEmail} numberOfLines={1}>{item.email}</Text>
        </View>
        <TouchableOpacity 
          activeOpacity={perms.canManage ? 0.7 : 1} 
          disabled={!perms.canManage}
          onPress={() => toggleStatus(item)} 
          style={[s.statusPill, { backgroundColor: item.is_active ? '#ecfdf5' : '#fef2f2' }]}
        >
          <View style={[s.statusDotSmall, { backgroundColor: item.is_active ? '#10b981' : '#ef4444' }]} />
          <Text style={[s.statusPillText, { color: item.is_active ? '#065f46' : '#991b1b' }]}>{item.is_active ? 'ACTIVE' : 'INACTIVE'}</Text>
        </TouchableOpacity>
      </View>
      {perms.canManage && (
        <View style={s.cardActions}>
          <TouchableOpacity style={s.actionBtn} onPress={() => openAssign(item)}>
            <LinearGradient colors={['#f5f3ff', '#ede9fe']} style={s.actionBtnInner}>
              <DynamicIcon name="filter" size={12} color="#8b5cf6" style={s.actionIcon} /><Text style={[s.actionBtnText, { color: '#8b5cf6' }]}>{isOperatorMode ? 'CLIENTS' : 'ASSIGN'}</Text>
            </LinearGradient>
          </TouchableOpacity>
          <TouchableOpacity style={s.actionBtn} onPress={() => openEdit(item)}>
            <LinearGradient colors={['#eff6ff', '#dbeafe']} style={s.actionBtnInner}>
              <DynamicIcon name="edit" size={12} color="#3b82f6" style={s.actionIcon} /><Text style={[s.actionBtnText, { color: '#3b82f6' }]}>EDIT</Text>
            </LinearGradient>
          </TouchableOpacity>
          <TouchableOpacity style={s.actionBtn} onPress={() => deleteStaff(item)}>
            <LinearGradient colors={['#fef2f2', '#fee2e2']} style={s.actionBtnInner}>
              <DynamicIcon name="trash" size={12} color="#ef4444" style={s.actionIcon} /><Text style={[s.actionBtnText, { color: '#ef4444' }]}>DEL</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  return (
    <View style={s.root}>
      <TopBar title={pageTitle} onBack={() => navigation.goBack()} />
      <View style={s.searchSection}>
        <View style={s.searchBar}>
          <IconSearch size={14} color={colors.gray400} />
          <TextInput style={s.searchInput} value={search} onChangeText={setSearch} placeholder="Search..." placeholderTextColor={colors.gray400} />
        </View>
        {perms.canManage && (
          <TouchableOpacity style={s.addBtn} onPress={openCreate}>
            <LinearGradient colors={gradients.brand} style={s.addBtnInner}><IconPlus size={16} color="#fff" /></LinearGradient>
          </TouchableOpacity>
        )}
      </View>

      {error ? <ErrorBanner message={error} onRetry={refresh} /> : loading && !refreshing ? <ListSkeleton count={6} /> : (
        <FlatList data={filtered} renderItem={renderItem} keyExtractor={item => item.id.toString()} contentContainerStyle={s.list} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.brandPrimary} />} ListEmptyComponent={<View style={s.empty}><Text style={s.emptyText}>No members found</Text></View>} />
      )}

      <Modal visible={showForm} animationType="fade" transparent onRequestClose={() => setShowForm(false)}>
        <View style={s.modalOverlay}>
          <TouchableOpacity style={s.modalBg} activeOpacity={1} onPress={() => setShowForm(false)} />
          <View style={s.modalContent}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>{editingId ? 'Update Staff' : 'New Staff'}</Text>
              <TouchableOpacity onPress={() => setShowForm(false)}><IconClose size={20} color={colors.gray400} /></TouchableOpacity>
            </View>
            <ScrollView>
              <View style={s.formRow}>
                <FormField label="FIRST NAME *" value={form.first_name} onChangeText={t => setForm(f => ({ ...f, first_name: t }))} />
                <View style={{width: 10}} />
                <FormField label="LAST NAME" value={form.last_name} onChangeText={t => setForm(f => ({ ...f, last_name: t }))} />
              </View>
              <FormField label="EMAIL *" value={form.email} onChangeText={t => setForm(f => ({ ...f, email: t }))} keyboardType="email-address" />
              <FormField label="PHONE" value={form.phone} onChangeText={t => setForm(f => ({ ...f, phone: t }))} keyboardType="phone-pad" />
              {!editingId && <FormField label="PASSWORD *" value={form.password} onChangeText={t => setForm(f => ({ ...f, password: t }))} secureTextEntry />}
            </ScrollView>
            <View style={s.modalFooter}>
              <TouchableOpacity style={s.modalCancel} onPress={() => setShowForm(false)}><Text style={s.modalCancelText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={s.modalSave} onPress={saveStaff} disabled={saving}>
                <LinearGradient colors={gradients.brand} style={s.modalSaveBtn}>
                  {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.modalSaveText}>{editingId ? 'UPDATE' : 'CREATE'}</Text>}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showAssign} animationType="slide" transparent onRequestClose={() => setShowAssign(false)}>
        <View style={s.modalOverlay}>
          <TouchableOpacity style={s.modalBg} activeOpacity={1} onPress={() => setShowAssign(false)} />
          <View style={s.modalContentFull}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Assign Access</Text>
              <TouchableOpacity onPress={() => setShowAssign(false)}><IconClose size={20} color={colors.gray400} /></TouchableOpacity>
            </View>
            <ScrollView style={{maxHeight: height * 0.7}}>
              {loadingAssign ? <ActivityIndicator style={{padding:40}} color={colors.brandPrimary} /> : (
                isOperatorMode ? (
                  <>
                    <Text style={s.sectionTitle}>Assign Clients</Text>
                    <View style={s.checkGrid}>
                      {assignData.clients.map(c => (
                        <TouchableOpacity key={c.id} style={[s.checkItem, selectedClientIds.includes(c.id) && s.checkItemActive]} onPress={() => setSelectedClientIds(p => p.includes(c.id) ? p.filter(i => i !== c.id) : [...p, c.id])}>
                          <Text style={[s.checkLabel, selectedClientIds.includes(c.id) && s.checkLabelActive]} numberOfLines={1}>{c.name}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                ) : (
                  <>
                    <Text style={s.sectionTitle}>Groups (Departments)</Text>
                    <View style={s.checkGrid}>
                      {assignData.groups.map(g => (
                        <TouchableOpacity key={g.id} style={[s.checkItem, selectedGroupIds.includes(g.id) && s.checkItemActive]} onPress={() => setSelectedGroupIds(p => p.includes(g.id) ? p.filter(i => i !== g.id) : [...p, g.id])}>
                          <Text style={[s.checkLabel, selectedGroupIds.includes(g.id) && s.checkLabelActive]} numberOfLines={1}>{g.name}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <Text style={s.sectionTitle}>Tables (Sections)</Text>
                    <View style={s.checkGrid}>
                      {assignData.tables.map(t => (
                        <TouchableOpacity key={t.id} style={[s.checkItem, selectedTableIds.includes(t.id) && s.checkItemActive]} onPress={() => setSelectedTableIds(p => p.includes(t.id) ? p.filter(i => i !== t.id) : [...p, t.id])}>
                          <Text style={[s.checkLabel, selectedTableIds.includes(t.id) && s.checkLabelActive]} numberOfLines={1}>{t.name}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                )
              )}
            </ScrollView>
            <View style={s.modalFooter}>
              <TouchableOpacity style={s.modalCancel} onPress={() => setShowAssign(false)}><Text style={s.modalCancelText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={s.modalSave} onPress={saveAssignment} disabled={savingAssign}>
                <LinearGradient colors={gradients.brand} style={s.modalSaveBtn}><Text style={s.modalSaveText}>SAVE CHANGES</Text></LinearGradient>
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

function FormField({ label, value, onChangeText, secureTextEntry, keyboardType }) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput style={s.fieldInput} value={value} onChangeText={onChangeText} secureTextEntry={secureTextEntry} keyboardType={keyboardType} placeholderTextColor={colors.gray300} />
    </View>
  );
}

const { height } = Dimensions.get('window');

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceBg },
  searchSection: { flexDirection: 'row', paddingHorizontal: 16, marginVertical: 12 },
  searchBar: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: radius.xs, paddingHorizontal: 12, height: 44, ...shadows.sm, borderWidth: 1, borderColor: colors.gray100, marginRight: 10 },
  searchInput: { flex: 1, marginLeft: 8, fontSize: 13, fontFamily: 'SairaSemiCondensed-Medium', color: colors.gray800 },
  addBtn: { width: 44, height: 44, borderRadius: radius.xs, ...shadows.md },
  addBtnInner: { flex: 1, borderRadius: radius.xs, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 12, paddingBottom: 100 },
  card: { backgroundColor: '#fff', borderRadius: radius.xs, padding: 12, marginBottom: 12, ...shadows.sm, borderWidth: 1, borderColor: colors.gray100 },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  cardAvatar: { width: 40, height: 40, borderRadius: radius.xs, backgroundColor: colors.gray50, alignItems: 'center', justifyContent: 'center', marginRight: 12, borderWidth: 1, borderColor: '#f1f5f9' },
  avatarText: { fontSize: 16, fontFamily: 'SairaSemiCondensed-Bold', color: colors.brandPrimary },
  cardInfo: { flex: 1 },
  cardName: { fontSize: 14, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray800 },
  cardEmail: { fontSize: 11, fontFamily: 'SairaSemiCondensed-Medium', color: colors.gray400 },
  statusPill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.xs },
  statusDotSmall: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  statusPillText: { fontSize: 8, fontFamily: 'SairaSemiCondensed-Bold' },
  cardActions: { flexDirection: 'row', gap: 10, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  actionBtn: { flex: 1, height: 32, borderRadius: radius.xs },
  actionBtnInner: { flex: 1, borderRadius: radius.xs, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  actionIcon: { marginRight: 8 },
  actionBtnText: { fontSize: 9, fontFamily: 'SairaSemiCondensed-Bold' },
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalBg: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  modalContent: { backgroundColor: '#fff', borderTopLeftRadius: radius.sm, borderTopRightRadius: radius.sm, padding: 20, maxHeight: '90%' },
  modalContentFull: { backgroundColor: '#fff', borderTopLeftRadius: radius.sm, borderTopRightRadius: radius.sm, padding: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 16, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray800 },
  field: { flex: 1, marginBottom: 16 },
  fieldLabel: { fontSize: 11, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray500, marginBottom: 6 },
  fieldInput: { backgroundColor: colors.gray50, borderRadius: radius.xs, paddingHorizontal: 12, height: 44, fontSize: 13, fontFamily: 'SairaSemiCondensed-Medium', color: colors.gray800, borderWidth: 1, borderColor: colors.gray100 },
  formRow: { flexDirection: 'row' },
  modalFooter: { flexDirection: 'row', gap: 12, marginTop: 10, paddingTop: 10 },
  modalCancel: { flex: 1, height: 44, borderRadius: radius.xs, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.gray100 },
  modalCancelText: { fontSize: 13, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray600 },
  modalSave: { flex: 2, height: 44, borderRadius: radius.xs },
  modalSaveBtn: { flex: 1, borderRadius: radius.xs, alignItems: 'center', justifyContent: 'center' },
  modalSaveText: { fontSize: 13, fontFamily: 'SairaSemiCondensed-Bold', color: '#fff' },
  sectionTitle: { fontSize: 11, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray400, letterSpacing: 1, marginBottom: 10, marginTop: 15, textTransform: 'uppercase' },
  checkGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  checkItem: { backgroundColor: colors.gray50, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radius.xs, borderWidth: 1, borderColor: '#e2e8f0', minWidth: '48%' },
  checkItemActive: { backgroundColor: 'rgba(102,126,234,0.1)', borderColor: colors.brandPrimary },
  checkLabel: { fontSize: 11, color: colors.gray600, fontFamily: 'SairaSemiCondensed-Medium' },
  checkLabelActive: { color: colors.brandPrimary, fontFamily: 'SairaSemiCondensed-Bold' },
  empty: { padding: 60, alignItems: 'center' },
  emptyText: { fontSize: 13, fontFamily: 'SairaSemiCondensed-Medium', color: colors.gray400 },
});
