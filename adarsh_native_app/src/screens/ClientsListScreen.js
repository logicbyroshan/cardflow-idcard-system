import React, { useState, useEffect, useMemo, useDeferredValue } from 'react';
import { View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet, ActivityIndicator, Switch, RefreshControl, Modal, ScrollView, Dimensions } from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import { IconPending, IconVerified, IconApproved, IconDownload, IconPool, IconTotal, IconSearch, IconFilter, IconPlus, IconChevronRight, IconTrash, IconEdit, IconHome, IconList, IconUsers, IconLogout, IconClose, IconCheck, IconProfile } from '../components/Icons';
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

export default function ClientsListScreen({ navigation }) {
  const { user, isImpersonating, startImpersonation, stopImpersonation } = useAuth();
  const theme = roleThemes[user?.role] || roleThemes.default;


  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // all, active, inactive
  const [showFilter, setShowFilter] = useState(false);
  const deferredSearch = useDeferredValue(search);
  
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

  // Permissions state
  const [showPerms, setShowPerms] = useState(false);
  const [permClientId, setPermClientId] = useState(null);
  const [permClientName, setPermClientName] = useState('');
  const [clientPerms, setClientPerms] = useState({});
  const [loadingPerms, setLoadingPerms] = useState(false);
  const [savingPerms, setSavingPerms] = useState(false);

  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });
  const [impersonatingId, setImpersonatingId] = useState(null);

  const [confirmModal, setConfirmModal] = useState({ 
    visible: false, title: '', message: '', icon: '', color: colors.brandPrimary, onConfirm: null 
  });

  const showToast = (msg, type = 'info') => setToast({ visible: true, message: msg, type });
  const isAdmin = !!user?.isAdmin;

  const loadClients = useCallback(async () => {
    try {
      const { ok, data } = await apiGet('/api/mobile/impersonate/users/');
      if (ok && (data?.success || data?.users)) {
        return (data.data || data.users || []).map(c => ({
          id: c.id, 
          name: c.name || c.full_name || '', 
          email: c.email || '',
          phone: c.phone || '', 
          is_active: c.is_active !== false, 
          role: c.role || '',
        }));
      } else {
        throw new Error(data?.message || 'Failed to load clients');
      }
    } catch (e) {
      throw new Error('Network error - check your connection');
    }
  }, []);

  const { data: clients = [], loading, refreshing, error, setError, refresh } = useRefreshableResource(loadClients, { initialData: [] });

  useEffect(() => { 
    // Handle "Add Client" from dashboard
    if (navigation.getState().routes.find(r => r.name === 'ClientsList')?.params?.openForm) {
      openCreate();
    }
  }, []);

  const openPerms = async (client) => {
    setPermClientId(client.id);
    setPermClientName(client.name);
    setLoadingPerms(true);
    setShowPerms(true);
    try {
      const { ok, data } = await apiGet(`/app/api/client/${client.id}/permissions/`);
      if (ok && data.success) {
        setClientPerms(data.data || {});
      } else {
        showToast('Failed to load permissions', 'error');
        setShowPerms(false);
      }
    } catch (e) {
      showToast('Network error', 'error');
      setShowPerms(false);
    }
    setLoadingPerms(false);
  };

  const savePerms = async () => {
    setSavingPerms(true);
    try {
      const { ok, data } = await apiPost(`/app/api/client/${permClientId}/permissions/update/`, {
        permissions: clientPerms
      });
      if (ok && data.success) {
        showToast('Permissions updated!', 'success');
        setShowPerms(false);
      } else {
        showToast(data?.message || 'Update failed', 'error');
      }
    } catch (e) {
      showToast('Network error', 'error');
    }
    setSavingPerms(false);
  };

  const filtered = useMemo(() => {
    return clients.filter(c => {
      const query = deferredSearch.toLowerCase();
      const matchesSearch = !deferredSearch.trim() || 
        (c.name || '').toLowerCase().includes(query) || 
        (c.email || '').toLowerCase().includes(query);
      
      const matchesStatus = statusFilter === 'all' || 
        (statusFilter === 'active' && c.is_active) || 
        (statusFilter === 'inactive' && !c.is_active);
      
      return matchesSearch && matchesStatus;
    });
  }, [deferredSearch, statusFilter, clients]);

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
      const url = editingId ? `/app/api/client/${editingId}/update/` : '/api/mobile/client/create/';
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
        <View style={s.avatar}><IconUsers size={14} color={colors.brandPrimary} /></View>
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
                <IconUsers size={10} color="#0ea5e9" style={[s.btnIcon, { marginRight: 6 }]} />
                <Text style={[s.textBtnLabel, { color: '#0ea5e9' }]}>SWITCH</Text>
              </>
            )}
          </TouchableOpacity>
        )}
        {user?.can_manage_staff && (
          <TouchableOpacity onPress={() => openAssign(item)} style={s.textBtn}>
            <IconList size={10} color="#8b5cf6" style={[s.btnIcon, { marginRight: 6 }]} />
            <Text style={[s.textBtnLabel, { color: '#8b5cf6' }]}>TABLES</Text>
          </TouchableOpacity>
        )}
        {isAdmin && (
          <TouchableOpacity onPress={() => openEdit(item)} style={s.textBtn}>
            <IconEdit size={10} color={colors.brandPrimary} style={[s.btnIcon, { marginRight: 6 }]} />
            <Text style={s.textBtnLabel}>EDIT</Text>
          </TouchableOpacity>
        )}
        {user?.is_super_admin && (
          <TouchableOpacity onPress={() => openPerms(item)} style={s.textBtn}>
            <IconCheck size={10} color="#22c55e" style={[s.btnIcon, { marginRight: 6 }]} />
            <Text style={[s.textBtnLabel, { color: '#22c55e' }]}>PERMS</Text>
          </TouchableOpacity>
        )}
        {user?.is_super_admin && (
          <TouchableOpacity onPress={() => deleteClient(item)} style={s.textBtn}>
            <IconTrash size={10} color="#ef4444" style={[s.btnIcon, { marginRight: 6 }]} />
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
        rightAction={isAdmin ? { icon: 'plus', onPress: openCreate } : null}
      >
        {/* Search Bar (Inside Gradient) */}
        <View style={s.searchRow}>
          <TouchableOpacity style={s.leftIconBtn} onPress={() => setShowFilter(true)} activeOpacity={0.7}>
            <IconFilter size={12} color="#fff" />
          </TouchableOpacity>
          <TextInput
            style={s.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search clients..."
            placeholderTextColor="rgba(255,255,255,0.5)"
          />
          <View style={s.rightIconBtn}>
            <IconSearch size={12} color="#fff" />
          </View>
        </View>
      </TopBar>

      {/* Impersonation Banner */}
      {isImpersonating && (
        <TouchableOpacity onPress={handleStopImpersonation} style={s.impBanner} activeOpacity={0.8}>
          <IconUsers size={14} color="#fff" />
          <Text style={s.impBannerText}>Impersonating · Tap to return</Text>
          <IconClose size={12} color="#fff" />
        </TouchableOpacity>
      )}

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} onRetry={refresh} />}
      {loading ? (
        <ListSkeleton rows={5} />
      ) : (
        <FlatList
          data={filtered}
          renderItem={renderItem}
          keyExtractor={item => item.id.toString()}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.brandLight} />}
          ListEmptyComponent={<View style={s.empty}><View style={s.emptyIcon}><IconUsers size={24} color={colors.gray300} /></View><Text style={s.emptyTitle}>{search ? 'No matching clients' : 'No clients found'}</Text></View>}
        />
      )}

      {/* Filter Drawer */}
      <Modal visible={showFilter} transparent animationType="none" onRequestClose={() => setShowFilter(false)}>
        <View style={s.filterOverlay}>
          <TouchableOpacity style={s.filterBackdrop} activeOpacity={1} onPress={() => setShowFilter(false)} />
          <View style={s.filterDrawer}>
            <View style={s.filterHeader}>
              <Text style={s.filterTitle}>Filter Clients</Text>
              <TouchableOpacity onPress={() => setShowFilter(false)} style={s.filterClose}><IconClose size={16} color={colors.gray400} /></TouchableOpacity>
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
                    <View style={s.tableIconSmall}><IconList size={10} color={colors.brandPrimary} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.assignTableName}>{table.name}</Text>
                      <Text style={s.assignTableMeta}>{table.pending_count || 0} pending · {table.group_name || 'No Group'}</Text>
                    </View>
                    <IconChevronRight size={10} color={colors.gray300} />
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

      {/* Permissions Toggle Modal */}
      <Modal visible={showPerms} animationType="slide" transparent onRequestClose={() => setShowPerms(false)}>
        <View style={s.modalOverlay}>
          <TouchableOpacity style={s.modalBg} activeOpacity={1} onPress={() => setShowPerms(false)} />
          <View style={s.modalSheet}>
            <View style={s.modalHandle} />
            <Text style={s.modalTitle}>Permissions: {permClientName}</Text>
            {loadingPerms ? (
              <ActivityIndicator style={{ padding: 40 }} color={colors.brandPrimary} />
            ) : (
              <ScrollView style={{ paddingHorizontal: 16 }}>
                <PermToggle 
                  label="Reprint & History" 
                  desc="Access to card reprint requests and service history" 
                  value={clientPerms.perm_idcard_info} 
                  onToggle={v => setClientPerms(p => ({ ...p, perm_idcard_info: v }))} 
                />
                <PermToggle 
                  label="Data Verification" 
                  desc="Ability to verify pending ID card records" 
                  value={clientPerms.perm_idcard_verify} 
                  onToggle={v => setClientPerms(p => ({ ...p, perm_idcard_verify: v }))} 
                />
                <PermToggle 
                  label="Final Approval" 
                  desc="Authority to approve records for printing" 
                  value={clientPerms.perm_idcard_approve} 
                  onToggle={v => setClientPerms(p => ({ ...p, perm_idcard_approve: v }))} 
                />
                <PermToggle 
                  label="Download Access" 
                  desc="Permission to download digital copies/Excel" 
                  value={clientPerms.perm_idcard_download} 
                  onToggle={v => setClientPerms(p => ({ ...p, perm_idcard_download: v }))} 
                />
                <PermToggle 
                  label="Web Panel Access" 
                  desc="Visibility of the institutional portfolio panel" 
                  value={clientPerms.perm_website_view} 
                  onToggle={v => setClientPerms(p => ({ ...p, perm_website_view: v }))} 
                />
              </ScrollView>
            )}
            <View style={s.formBtns}>
              <TouchableOpacity onPress={() => setShowPerms(false)} style={s.cancelBtn}><Text style={s.cancelBtnText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity onPress={savePerms} disabled={savingPerms} style={s.saveBtnWrap}>
                <LinearGradient colors={gradients.brand} style={s.saveBtn}>
                  {savingPerms && <ActivityIndicator size="small" color="#fff" />}
                  <Text style={s.saveBtnText}>Save Changes</Text>
                </LinearGradient>
              </TouchableOpacity>
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

function PermToggle({ label, desc, value, onToggle }) {
  return (
    <View style={s.permToggleRow}>
      <View style={{ flex: 1 }}>
        <Text style={s.permToggleLabel}>{label}</Text>
        <Text style={s.permToggleDesc}>{desc}</Text>
      </View>
      <Switch 
        value={!!value} 
        onValueChange={onToggle} 
        trackColor={{ false: '#e2e8f0', true: colors.brandPrimary + '50' }}
        thumbColor={value ? colors.brandPrimary : '#94a3b8'}
      />
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
  impBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, backgroundColor: '#f59e0b' },
  impBannerText: { fontSize: 11, fontFamily: fontFamily.bold, color: '#fff', letterSpacing: 0.5 },
  list: { padding: 16, paddingBottom: 32 },
  card: { backgroundColor: '#fff', borderRadius: radius.sm, borderWidth: 1, borderColor: '#f1f5f9', overflow: 'hidden', ...shadows.sm },
  cardTop: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  avatar: { width: 40, height: 40, borderRadius: radius.xs, backgroundColor: 'rgba(51,183,239,0.08)', alignItems: 'center', justifyContent: 'center' },
  cardInfo: { flex: 1, minWidth: 0 },
  name: { fontSize: 14, fontFamily: fontFamily.bold, color: colors.gray800 },
  email: { fontSize: 11, color: colors.gray400, marginTop: 1, fontFamily: fontFamily.medium },
  statusPill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.sm },
  statusDotSmall: { width: 6, height: 6, borderRadius: 3 },
  statusPillText: { fontSize: 9, fontFamily: fontFamily.bold, letterSpacing: 0.5 },
  cardActions: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingHorizontal: 10, paddingVertical: 10 },
  textBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 8, backgroundColor: '#f8fafc', borderRadius: radius.sm, borderWidth: 1, borderColor: '#f1f5f9' },
  btnIcon: { marginBottom: 1 },
  textBtnLabel: { fontSize: 10, fontFamily: fontFamily.bold, color: colors.brandPrimary, letterSpacing: 0.5 },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyIcon: { width: 64, height: 64, borderRadius: radius.xxl, backgroundColor: colors.gray100, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: 13, fontFamily: fontFamily.semibold, color: colors.gray400 },
  permToggleRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  permToggleLabel: { fontSize: 14, fontFamily: fontFamily.bold, color: colors.gray800 },
  permToggleDesc: { fontSize: 11, color: colors.gray500, marginTop: 2, fontFamily: fontFamily.regular },
  // Filter Drawer
  filterOverlay: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end' },
  filterBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15, 23, 42, 0.4)' },
  filterDrawer: { width: width * 0.75, height: '100%', backgroundColor: '#fff', paddingTop: 40 },
  filterHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  filterTitle: { fontSize: 16, fontFamily: fontFamily.bold, color: colors.gray800 },
  filterClose: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.gray50, alignItems: 'center', justifyContent: 'center' },
  filterContent: { flex: 1, padding: 20 },
  filterLabel: { fontSize: 10, fontFamily: fontFamily.bold, color: colors.gray400, letterSpacing: 1.2, marginBottom: 12 },
  filterChips: { flexDirection: 'row', flexWrap: 'wrap' },
  filterChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.sm, backgroundColor: colors.gray50, borderWidth: 1, borderColor: '#e2e8f0' },
  filterChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  filterChipText: { fontSize: 11, fontFamily: fontFamily.bold, color: colors.gray600 },
  filterChipTextActive: { color: '#fff' },
  filterFooter: { flexDirection: 'row', padding: 20, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  resetBtn: { flex: 1, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: colors.gray100 },
  resetBtnText: { fontSize: 12, fontFamily: fontFamily.semibold, color: colors.gray600 },
  applyBtnWrap: { flex: 2, borderRadius: radius.sm, overflow: 'hidden' },
  applyBtn: { paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  applyBtnText: { fontSize: 12, fontFamily: fontFamily.bold, color: '#fff' },
  // Modal Sheet
  modalOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100 },
  modalBg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' },
  modalSheet: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#fff', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingBottom: 40, ...shadows.xl },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#e5e7eb', alignSelf: 'center', marginTop: 12, marginBottom: 8 },
  modalTitle: { fontSize: 16, fontFamily: fontFamily.bold, color: colors.gray800, paddingHorizontal: 16, marginBottom: 16 },
  formFields: { paddingHorizontal: 16 },
  field: { marginBottom: 12 },
  fieldLabel: { fontSize: 10, fontFamily: fontFamily.bold, color: colors.gray500, letterSpacing: 0.8, marginBottom: 4 },
  fieldInput: { backgroundColor: colors.gray50, borderWidth: 1, borderColor: '#e2e8f0', borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: colors.gray700, fontFamily: fontFamily.regular },
  fieldDisabled: { backgroundColor: '#f1f5f9', color: colors.gray400 },
  formBtns: { flexDirection: 'row', paddingHorizontal: 16, marginTop: 16 },
  cancelBtn: { flex: 1, paddingVertical: 14, backgroundColor: colors.gray100, borderRadius: radius.md, alignItems: 'center' },
  cancelBtnText: { fontSize: 12, fontFamily: fontFamily.semibold, color: colors.gray600 },
  saveBtnWrap: { flex: 2, borderRadius: radius.md, overflow: 'hidden' },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14 },
  saveBtnText: { fontSize: 12, fontFamily: fontFamily.bold, color: '#fff' },
  // Assign (Tables)
  assignRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  tableIconSmall: { width: 30, height: 30, borderRadius: radius.xs, backgroundColor: 'rgba(51,183,239,0.05)', alignItems: 'center', justifyContent: 'center' },
  assignTableName: { fontSize: 13, fontFamily: fontFamily.bold, color: colors.gray700 },
  assignTableMeta: { fontSize: 10, color: colors.gray400, marginTop: 2, fontFamily: fontFamily.medium },
  emptyLabel: { fontSize: 12, color: colors.gray400, fontStyle: 'italic', paddingVertical: 20, textAlign: 'center', fontFamily: fontFamily.regular },
});
