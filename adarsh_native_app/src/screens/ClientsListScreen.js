import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet, ActivityIndicator, Switch, RefreshControl, Modal, ScrollView, Dimensions } from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import TopBar from '../components/TopBar';
import Toast from '../components/Toast';
import { ListSkeleton } from '../components/Skeleton';
import { ErrorBanner } from '../components/NetworkGuard';
import ConfirmModal from '../components/ConfirmModal';
import { apiGet, apiPost } from '../api/client';
import { colors, gradients, shadows, radius, roleThemes, fontFamily } from '../theme';
import { useAuth } from '../context/AuthContext';

const { width } = Dimensions.get('window');

export default function ClientsListScreen({ navigation }) {
  const { user, isImpersonating, startImpersonation, stopImpersonation } = useAuth();
  const theme = roleThemes[user?.role] || roleThemes.default;

  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // all, active, inactive
  
  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '' });
  const [saving, setSaving] = useState(false);

  // Assign state (Quick access to client tables)
  const [showAssign, setShowAssign] = useState(false);
  const [assignClientId, setAssignClientId] = useState(null);
  const [assignClientName, setAssignClientName] = useState('');
  const [assignTables, setAssignTables] = useState([]);
  const [loadingAssign, setLoadingAssign] = useState(false);

  // Filter drawer
  const [showFilter, setShowFilter] = useState(false);

  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });
  const [impersonatingId, setImpersonatingId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const [confirmModal, setConfirmModal] = useState({ 
    visible: false, title: '', message: '', icon: '', color: colors.brandPrimary, onConfirm: null 
  });

  const showToast = (msg, type = 'info') => setToast({ visible: true, message: msg, type });
  const isAdmin = ['super_admin', 'admin_staff', 'pro_user'].includes(user?.role);

  const loadClients = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const { ok, data } = await apiGet('/app/api/impersonate/users/');
      if (ok && (data?.success || data?.users)) {
        const cl = (data.data || data.users || []).map(c => ({
          id: c.id, 
          name: c.name || c.full_name || '', 
          email: c.email || '',
          phone: c.phone || '', 
          is_active: c.is_active !== false, 
          role: c.role || '',
        }));
        setClients(cl);
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

  const filtered = useMemo(() => {
    return clients.filter(c => {
      const matchesSearch = !search.trim() || 
        (c.name || '').toLowerCase().includes(search.toLowerCase()) || 
        (c.email || '').toLowerCase().includes(search.toLowerCase());
      
      const matchesStatus = statusFilter === 'all' || 
        (statusFilter === 'active' && c.is_active) || 
        (statusFilter === 'inactive' && !c.is_active);
      
      return matchesSearch && matchesStatus;
    });
  }, [search, statusFilter, clients]);

  const openCreate = () => {
    setEditingId(null);
    setForm({ name: '', email: '', phone: '', password: '' });
    setShowForm(true);
  };

  const openEdit = async (client) => {
    setEditingId(client.id);
    setForm({ name: client.name || '', email: client.email || '', phone: client.phone || '', password: '' });
    setShowForm(true);
    try {
      const { ok, data } = await apiGet(`/app/api/client/${client.id}/`);
      if (ok && data?.success) {
        const c = data.client || {};
        setForm({ name: c.name || client.name || '', email: c.email || client.email || '', phone: c.phone || client.phone || '', password: '' });
      }
    } catch (e) { }
  };

  const saveForm = async () => {
    if (!form.name.trim()) { showToast('Name is required', 'error'); return; }
    if (!editingId && !form.email.trim()) { showToast('Email is required', 'error'); return; }
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

  const openAssign = async (client) => {
    setAssignClientId(client.id);
    setAssignClientName(client.name);
    setShowAssign(true);
    setLoadingAssign(true);
    try {
      const { data } = await apiGet(`/app/api/client/${client.id}/tables/`);
      if (data?.success) setAssignTables(data.tables || data.data || []);
    } catch (e) { }
    setLoadingAssign(false);
  };

  const toggleClient = async (client) => {
    try {
      const { data } = await apiPost(`/app/api/client/${client.id}/toggle/`, {});
      showToast(data?.success ? (data.message || 'Toggled') : (data?.message || 'Failed'), data?.success ? 'success' : 'error');
      if (data?.success) loadClients();
    } catch (e) { showToast('Network error', 'error'); }
  };

  const deleteClient = (client) => {
    setConfirmModal({
      visible: true,
      title: 'Delete Client?',
      message: `Are you sure you want to delete ${client.name}? This action cannot be undone.`,
      icon: 'trash-alt',
      color: '#ef4444',
      onConfirm: async () => {
        setConfirmModal(p => ({ ...p, visible: false }));
        try {
          const { data } = await apiPost(`/app/api/client/${client.id}/delete/`, {});
          showToast(data?.success ? (data.message || 'Deleted') : (data?.message || 'Failed'), data?.success ? 'success' : 'error');
          if (data?.success) loadClients();
        } catch (e) { showToast('Network error', 'error'); }
      }
    });
  };

  const handleImpersonate = (client) => {
    setConfirmModal({
      visible: true,
      title: 'Switch to Client?',
      message: `Act as "${client.name}"? You can switch back anytime using the top banner.`,
      icon: 'user-secret',
      color: '#0ea5e9',
      onConfirm: async () => {
        setConfirmModal(p => ({ ...p, visible: false }));
        setImpersonatingId(client.id);
        const result = await startImpersonation(client.id);
        setImpersonatingId(null);
        if (result.success) {
          showToast(result.message || 'Switched!', 'success');
          setTimeout(() => navigation.reset({ index: 0, routes: [{ name: 'Home' }] }), 500);
        } else {
          showToast(result.message || 'Failed to switch', 'error');
        }
      }
    });
  };

  const handleStopImpersonation = async () => {
    const result = await stopImpersonation();
    if (result.success) {
      showToast(result.message || 'Returned!', 'success');
      setTimeout(() => navigation.reset({ index: 0, routes: [{ name: 'Home' }] }), 500);
    } else {
      showToast(result.message || 'Failed', 'error');
    }
  };

  const renderItem = ({ item }) => (
    <View style={s.card}>
      <View style={s.cardTop}>
        <View style={s.avatar}><FontAwesome5 name="building" size={14} color={colors.brandPrimary} /></View>
        <View style={s.cardInfo}>
          <Text style={s.name} numberOfLines={1}>{item.name}</Text>
          <Text style={s.email} numberOfLines={1}>{item.email || item.phone || 'No contact'}</Text>
        </View>
        <TouchableOpacity 
          activeOpacity={0.7}
          onPress={() => toggleClient(item)} 
          style={[s.statusPill, { backgroundColor: item.is_active ? '#dcfce7' : '#fee2e2' }]}
        >
          <View style={[s.statusDotSmall, { backgroundColor: item.is_active ? '#22c55e' : '#ef4444' }]} />
          <Text style={[s.statusPillText, { color: item.is_active ? '#15803d' : '#991b1b' }]}>
            {item.is_active ? 'ACTIVE' : 'INACTIVE'}
          </Text>
        </TouchableOpacity>
      </View>
      <View style={s.cardActions}>
        {isAdmin && (
          <TouchableOpacity onPress={() => handleImpersonate(item)} disabled={impersonatingId === item.id} style={s.textBtn}>
            {impersonatingId === item.id ? (
              <ActivityIndicator size="small" color={colors.brandPrimary} />
            ) : (
              <>
                <FontAwesome5 name="user-secret" size={10} color="#0ea5e9" style={s.btnIcon} />
                <Text style={[s.textBtnLabel, { color: '#0ea5e9' }]}>SWITCH</Text>
              </>
            )}
          </TouchableOpacity>
        )}
        {user?.can_manage_staff && (
          <TouchableOpacity onPress={() => openAssign(item)} style={s.textBtn}>
            <FontAwesome5 name="layer-group" size={10} color="#8b5cf6" style={s.btnIcon} />
            <Text style={[s.textBtnLabel, { color: '#8b5cf6' }]}>TABLES</Text>
          </TouchableOpacity>
        )}
        {user?.can_manage_clients && (
          <TouchableOpacity onPress={() => openEdit(item)} style={s.textBtn}>
            <FontAwesome5 name="pen" size={10} color={colors.brandPrimary} style={s.btnIcon} />
            <Text style={s.textBtnLabel}>EDIT</Text>
          </TouchableOpacity>
        )}
        {user?.is_super_admin && (
          <TouchableOpacity onPress={() => deleteClient(item)} style={s.textBtn}>
            <FontAwesome5 name="trash-alt" size={10} color="#ef4444" style={s.btnIcon} />
            <Text style={[s.textBtnLabel, { color: '#ef4444' }]}>DELETE</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  return (
    <View style={s.root}>
      <TopBar 
        title="Client Management" 
        subtitle="Manage institutions & organizations" 
        onBack={() => navigation.goBack()} 
        rightAction={user?.can_manage_clients ? { icon: 'plus', onPress: openCreate } : null}
      >
        {/* Search Bar (Inside Gradient) */}
        <View style={s.searchRow}>
          <TouchableOpacity style={s.leftIconBtn} onPress={() => setShowFilter(true)} activeOpacity={0.7}>
            <FontAwesome5 name="filter" size={12} color="#fff" />
          </TouchableOpacity>
          <TextInput
            style={s.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search clients..."
            placeholderTextColor="rgba(255,255,255,0.5)"
          />
          <View style={s.rightIconBtn}>
            <FontAwesome5 name="search" size={12} color="#fff" />
          </View>
        </View>
      </TopBar>

      {/* Impersonation Banner */}
      {isImpersonating && (
        <TouchableOpacity onPress={handleStopImpersonation} style={s.impBanner} activeOpacity={0.8}>
          <FontAwesome5 name="user-secret" size={14} color="#fff" />
          <Text style={s.impBannerText}>Impersonating · Tap to return</Text>
          <FontAwesome5 name="times" size={12} color="#fff" />
        </TouchableOpacity>
      )}

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} onRetry={() => loadClients(true)} />}
      {loading ? (
        <ListSkeleton rows={5} />
      ) : (
        <FlatList
          data={filtered}
          renderItem={renderItem}
          keyExtractor={item => item.id.toString()}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadClients(true)} tintColor={colors.brandLight} />}
          ListEmptyComponent={<View style={s.empty}><View style={s.emptyIcon}><FontAwesome5 name="building" size={24} color={colors.gray300} /></View><Text style={s.emptyTitle}>{search ? 'No matching clients' : 'No clients found'}</Text></View>}
        />
      )}

      {/* Filter Drawer */}
      <Modal visible={showFilter} transparent animationType="none" onRequestClose={() => setShowFilter(false)}>
        <View style={s.filterOverlay}>
          <TouchableOpacity style={s.filterBackdrop} activeOpacity={1} onPress={() => setShowFilter(false)} />
          <View style={s.filterDrawer}>
            <View style={s.filterHeader}>
              <Text style={s.filterTitle}>Filter Clients</Text>
              <TouchableOpacity onPress={() => setShowFilter(false)} style={s.filterClose}><FontAwesome5 name="times" size={16} color={colors.gray400} /></TouchableOpacity>
            </View>
            <ScrollView style={s.filterContent}>
              <Text style={s.filterLabel}>CLIENT STATUS</Text>
              <View style={s.filterChips}>
                {['all', 'active', 'inactive'].map(val => (
                  <TouchableOpacity key={val} style={[s.filterChip, statusFilter === val && s.filterChipActive]} onPress={() => setStatusFilter(val)}>
                    <Text style={[s.filterChipText, statusFilter === val && s.filterChipTextActive]}>{val.toUpperCase()}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
            <View style={s.filterFooter}>
              <TouchableOpacity onPress={() => { setStatusFilter('all'); setSearch(''); setShowFilter(false); }} style={s.resetBtn}><Text style={s.resetBtnText}>Reset All</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => setShowFilter(false)} style={s.applyBtnWrap}>
                <LinearGradient colors={gradients.brand} style={s.applyBtn}><Text style={s.applyBtnText}>Apply Filters</Text></LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Add/Edit Modal Drawer */}
      <Modal visible={showForm} animationType="slide" transparent onRequestClose={() => setShowForm(false)}>
        <View style={s.modalOverlay}>
          <TouchableOpacity style={s.modalBg} activeOpacity={1} onPress={() => setShowForm(false)} />
          <View style={s.modalSheet}>
            <View style={s.modalHandle} />
            <Text style={s.modalTitle}>{editingId ? 'Edit Client' : 'Add New Client'}</Text>
            <ScrollView style={s.formFields} keyboardShouldPersistTaps="handled">
              <FormField label="CLIENT NAME" value={form.name} onChangeText={t => setForm(p => ({ ...p, name: t }))} placeholder="e.g. Adarsh International School" />
              <FormField label="EMAIL ADDRESS" value={form.email} onChangeText={t => setForm(p => ({ ...p, email: t }))} placeholder="email@example.com" keyboardType="email-address" disabled={!!editingId} />
              <FormField label="PHONE NUMBER" value={form.phone} onChangeText={t => setForm(p => ({ ...p, phone: t }))} placeholder="Phone number" keyboardType="phone-pad" />
              {!editingId && <FormField label="TEMPORARY PASSWORD" value={form.password} onChangeText={t => setForm(p => ({ ...p, password: t }))} placeholder="Min 6 characters" secureTextEntry />}
            </ScrollView>
            <View style={s.formBtns}>
              <TouchableOpacity onPress={() => setShowForm(false)} style={s.cancelBtn}><Text style={s.cancelBtnText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity onPress={saveForm} disabled={saving} style={s.saveBtnWrap}>
                <LinearGradient colors={gradients.brand} style={s.saveBtn}>
                  {saving && <ActivityIndicator size="small" color="#fff" />}
                  <Text style={s.saveBtnText}>{editingId ? 'Update Client' : 'Create Client'}</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Tables (Assign) Drawer */}
      <Modal visible={showAssign} animationType="slide" transparent onRequestClose={() => setShowAssign(false)}>
        <View style={s.modalOverlay}>
          <TouchableOpacity style={s.modalBg} activeOpacity={1} onPress={() => setShowAssign(false)} />
          <View style={[s.modalSheet, { maxHeight: '80%' }]}>
            <View style={s.modalHandle} />
            <Text style={s.modalTitle}>Tables for {assignClientName}</Text>
            {loadingAssign ? (
              <ActivityIndicator style={{ padding: 40 }} color={colors.brandPrimary} />
            ) : (
              <ScrollView style={{ paddingHorizontal: 16 }} showsVerticalScrollIndicator={false}>
                {assignTables.length === 0 && <Text style={s.emptyLabel}>No tables assigned to this client yet.</Text>}
                {assignTables.map(table => (
                  <TouchableOpacity 
                    key={table.id} 
                    style={s.assignRow}
                    onPress={() => { setShowAssign(false); navigation.navigate('CardList', { tableId: table.id, status: 'pending' }); }}
                  >
                    <View style={s.tableIconSmall}><FontAwesome5 name="table" size={10} color={colors.brandPrimary} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.assignTableName}>{table.name}</Text>
                      <Text style={s.assignTableMeta}>{table.pending_count || 0} pending · {table.group_name || 'No Group'}</Text>
                    </View>
                    <FontAwesome5 name="chevron-right" size={10} color={colors.gray300} />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
            <View style={{ padding: 16 }}>
              <TouchableOpacity onPress={() => setShowAssign(false)} style={s.cancelBtn}><Text style={s.cancelBtnText}>Close</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <ConfirmModal 
        visible={confirmModal.visible}
        onClose={() => setConfirmModal(p => ({ ...p, visible: false }))}
        onConfirm={confirmModal.onConfirm}
        title={confirmModal.title}
        message={confirmModal.message}
        icon={confirmModal.icon}
        confirmColor={confirmModal.color}
      />

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
  searchRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: radius.md, marginHorizontal: 16, marginTop: 12, marginBottom: 8, paddingHorizontal: 10, height: 44 },
  leftIconBtn: { padding: 8 },
  rightIconBtn: { padding: 8 },
  searchInput: { flex: 1, color: '#fff', fontSize: 13, paddingHorizontal: 8 },
  impBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 10, backgroundColor: '#f59e0b' },
  impBannerText: { fontSize: 11, fontWeight: '800', color: '#fff', letterSpacing: 0.5 },
  list: { padding: 16, gap: 10, paddingBottom: 32 },
  card: { backgroundColor: '#fff', borderRadius: radius.sm, borderWidth: 1, borderColor: '#f1f5f9', overflow: 'hidden', ...shadows.sm },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  avatar: { width: 40, height: 40, borderRadius: radius.xs, backgroundColor: 'rgba(51,183,239,0.08)', alignItems: 'center', justifyContent: 'center' },
  cardInfo: { flex: 1, minWidth: 0 },
  name: { fontSize: 14, fontWeight: '700', color: colors.gray800 },
  email: { fontSize: 11, color: colors.gray400, marginTop: 1 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.sm },
  statusDotSmall: { width: 6, height: 6, borderRadius: 3 },
  statusPillText: { fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  cardActions: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingHorizontal: 10, paddingVertical: 10, gap: 8 },
  textBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8, backgroundColor: '#f8fafc', borderRadius: radius.sm, borderWidth: 1, borderColor: '#f1f5f9' },
  btnIcon: { marginBottom: 1 },
  textBtnLabel: { fontSize: 10, fontWeight: '800', color: colors.brandPrimary, letterSpacing: 0.5 },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyIcon: { width: 64, height: 64, borderRadius: radius.xxl, backgroundColor: colors.gray100, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: 13, fontWeight: '600', color: colors.gray400 },
  // Filter Drawer
  filterOverlay: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end' },
  filterBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15, 23, 42, 0.4)' },
  filterDrawer: { width: width * 0.75, height: '100%', backgroundColor: '#fff', paddingTop: 40 },
  filterHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  filterTitle: { fontSize: 16, fontWeight: '700', color: colors.gray800 },
  filterClose: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.gray50, alignItems: 'center', justifyContent: 'center' },
  filterContent: { flex: 1, padding: 20 },
  filterLabel: { fontSize: 10, fontWeight: '900', color: colors.gray400, letterSpacing: 1.2, marginBottom: 12 },
  filterChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.sm, backgroundColor: colors.gray50, borderWidth: 1, borderColor: '#e2e8f0' },
  filterChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  filterChipText: { fontSize: 11, fontWeight: '700', color: colors.gray600 },
  filterChipTextActive: { color: '#fff' },
  filterFooter: { flexDirection: 'row', padding: 20, gap: 12, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  resetBtn: { flex: 1, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: colors.gray100 },
  resetBtnText: { fontSize: 12, fontWeight: '600', color: colors.gray600 },
  applyBtnWrap: { flex: 2, borderRadius: radius.sm, overflow: 'hidden' },
  applyBtn: { paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  applyBtnText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  // Modal Sheet
  modalOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100 },
  modalBg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' },
  modalSheet: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#fff', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingBottom: 40, ...shadows.xl },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#e5e7eb', alignSelf: 'center', marginTop: 12, marginBottom: 8 },
  modalTitle: { fontSize: 16, fontWeight: '700', color: colors.gray800, paddingHorizontal: 16, marginBottom: 16 },
  formFields: { paddingHorizontal: 16, gap: 12 },
  field: { marginBottom: 12 },
  fieldLabel: { fontSize: 10, fontWeight: '700', color: colors.gray500, letterSpacing: 0.8, marginBottom: 4 },
  fieldInput: { backgroundColor: colors.gray50, borderWidth: 1, borderColor: '#e2e8f0', borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: colors.gray700 },
  fieldDisabled: { backgroundColor: '#f1f5f9', color: colors.gray400 },
  formBtns: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginTop: 16 },
  cancelBtn: { flex: 1, paddingVertical: 14, backgroundColor: colors.gray100, borderRadius: radius.md, alignItems: 'center' },
  cancelBtnText: { fontSize: 12, fontWeight: '600', color: colors.gray600 },
  saveBtnWrap: { flex: 2, borderRadius: radius.md, overflow: 'hidden' },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14 },
  saveBtnText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  // Assign (Tables)
  assignRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f1f5f9', gap: 12 },
  tableIconSmall: { width: 30, height: 30, borderRadius: radius.xs, backgroundColor: 'rgba(51,183,239,0.05)', alignItems: 'center', justifyContent: 'center' },
  assignTableName: { fontSize: 13, fontWeight: '700', color: colors.gray700 },
  assignTableMeta: { fontSize: 10, color: colors.gray400, marginTop: 2 },
  emptyLabel: { fontSize: 12, color: colors.gray400, fontStyle: 'italic', paddingVertical: 20, textAlign: 'center' },
});
