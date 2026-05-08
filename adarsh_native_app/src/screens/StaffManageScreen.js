import React, { useState, useMemo, useCallback, useDeferredValue } from 'react';
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
import useRefreshableResource from '../hooks/useRefreshableResource';

const { width } = Dimensions.get('window');

export default function StaffManageScreen({ navigation }) {
  const { user, isImpersonating, stopImpersonation } = useAuth();
  const [staff, setStaff] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // all, active, inactive
  const deferredSearch = useDeferredValue(search);
  
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', phone: '', password: '' });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });

  // Assignment state
  const [showAssign, setShowAssign] = useState(false);
  const [assigningId, setAssigningId] = useState(null);
  const [assignData, setAssignData] = useState({ groups: [], tables: [] });
  const [selectedGroupIds, setSelectedGroupIds] = useState([]);
  const [selectedTableIds, setSelectedTableIds] = useState([]);
  const [allowedClasses, setAllowedClasses] = useState('');
  const [allowedSections, setAllowedSections] = useState('');
  const [loadingAssign, setLoadingAssign] = useState(false);
  const [savingAssign, setSavingAssign] = useState(false);

  // Filter drawer
  const [showFilter, setShowFilter] = useState(false);

  // Confirm Modal state
  const [confirmModal, setConfirmModal] = useState({ 
    visible: false, title: '', message: '', icon: '', color: colors.brandPrimary, onConfirm: null 
  });

  const showToast = (msg, type = 'info') => setToast({ visible: true, message: msg, type });
  const loadStaff = useCallback(async () => {
    try {
      const { ok, data } = await apiGet('/app/api/staff/');
      if (ok && data?.success) {
        setStaff(data.data?.staff || []);
      } else {
        throw new Error(data?.message || 'Failed to load assistants');
      }
    } catch (e) {
      throw new Error('Network error - check your connection');
    }
  }, []);

  const { loading, refreshing, error, refresh } = useRefreshableResource(loadStaff, { initialData: [] });

  const handleStopImpersonation = async () => {
    const result = await stopImpersonation();
    if (result.success) {
      showToast(result.message || 'Returned!', 'success');
      setTimeout(() => navigation.reset({ index: 0, routes: [{ name: 'Home' }] }), 500);
    } else {
      showToast(result.message || 'Failed', 'error');
    }
  };

  const filtered = useMemo(() => {
    return staff.filter(s => {
      const name = (s.name || '').toLowerCase();
      const email = (s.email || '').toLowerCase();
      const q = deferredSearch.toLowerCase();
      const matchesSearch = !deferredSearch.trim() || name.includes(q) || email.includes(q);
      const matchesStatus = statusFilter === 'all' || 
        (statusFilter === 'active' && s.is_active) || 
        (statusFilter === 'inactive' && !s.is_active);
      return matchesSearch && matchesStatus;
    });
  }, [deferredSearch, statusFilter, staff]);

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

  const openAssign = async (member) => {
    setAssigningId(member.id);
    setSelectedGroupIds(member.assigned_group_ids || []);
    setSelectedTableIds(member.assigned_table_ids || []);
    setAllowedClasses((member.allowed_classes || []).join(', '));
    setAllowedSections((member.allowed_sections || []).join(', '));
    setShowAssign(true);
    setLoadingAssign(true);
    try {
      const { ok, data } = await apiGet(`/app/api/staff/${member.id}/assignable-items/`);
      if (ok && data?.success) {
        setAssignData({ groups: data.groups || [], tables: data.tables || [] });
      } else {
        showToast(data?.message || 'Failed to load assignable items', 'error');
      }
    } catch (e) {
      showToast('Network error', 'error');
    }
    setLoadingAssign(false);
  };

  const toggleGroupSelection = (id) => {
    setSelectedGroupIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const toggleTableSelection = (id) => {
    setSelectedTableIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const saveAssignment = async () => {
    setSavingAssign(true);
    try {
      const { ok, data } = await apiPost(`/app/api/staff/${assigningId}/assign/`, {
        assigned_groups: selectedGroupIds,
        assigned_table_ids: selectedTableIds,
        allowed_classes: allowedClasses.split(',').map(s => s.trim()).filter(s => !!s),
        allowed_sections: allowedSections.split(',').map(s => s.trim()).filter(s => !!s),
        assignment_id_source: 'auto'
      });
      if (ok && data?.success) {
        showToast(data.message || 'Assignments updated', 'success');
        setShowAssign(false);
        refresh();
      } else {
        showToast(data?.message || 'Failed to update assignments', 'error');
      }
    } catch (e) {
      showToast('Network error', 'error');
    }
    setSavingAssign(false);
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
      if (data?.success) { setShowForm(false); refresh(); }
    } catch (e) { showToast('Network error', 'error'); }
    setSaving(false);
  };

  const toggleActive = async (member) => {
    try {
      const { data } = await apiPost(`/app/api/staff/${member.id}/toggle/`, {});
      showToast(data?.success ? (data.message || 'Toggled') : (data?.message || 'Failed'), data?.success ? 'success' : 'error');
      if (data?.success) refresh();
    } catch (e) { showToast('Network error', 'error'); }
  };

  const deleteMember = (item) => {
    setConfirmModal({
      visible: true,
      title: 'Delete Assistant?',
      message: `Are you sure you want to delete ${item.name}? This action cannot be undone.`,
      icon: 'user-minus',
      color: '#ef4444',
      onConfirm: async () => {
        setConfirmModal(p => ({ ...p, visible: false }));
        try {
          const { data } = await apiPost(`/app/api/staff/${item.id}/delete/`, {});
          showToast(data?.message || 'Deleted', data?.success ? 'success' : 'error');
          if (data?.success) refresh();
        } catch (e) { showToast('Network error', 'error'); }
      }
    });
  };

  const renderItem = ({ item }) => (
    <View style={s.card}>
      <View style={s.cardTop}>
        <View style={s.avatar}><Text style={s.avatarText}>{(item.name || 'S').slice(0, 2).toUpperCase()}</Text></View>
        <View style={s.cardInfo}>
          <Text style={s.name} numberOfLines={1}>{item.name}</Text>
          <Text style={s.email} numberOfLines={1}>{item.email}</Text>
        </View>
        <TouchableOpacity 
          activeOpacity={0.7}
          onPress={() => toggleActive(item)} 
          style={[s.statusPill, { backgroundColor: item.is_active ? '#dcfce7' : '#fee2e2' }]}
        >
          <View style={[s.statusDotSmall, { backgroundColor: item.is_active ? '#22c55e' : '#ef4444' }]} />
          <Text style={[s.statusPillText, { color: item.is_active ? '#15803d' : '#991b1b' }]}>
            {item.is_active ? 'ACTIVE' : 'INACTIVE'}
          </Text>
        </TouchableOpacity>
      </View>
      <View style={s.cardActions}>
        {user?.can_manage_staff && (
          <TouchableOpacity onPress={() => openEdit(item)} style={s.textBtn}>
            <FontAwesome5 name="pen" size={10} color={colors.brandPrimary} style={s.btnIcon} />
            <Text style={s.textBtnLabel}>EDIT</Text>
          </TouchableOpacity>
        )}
        {user?.can_manage_staff && user?.role !== 'super_admin' && (
          <TouchableOpacity onPress={() => openAssign(item)} style={s.textBtn}>
            <FontAwesome5 name="layer-group" size={10} color="#8b5cf6" style={s.btnIcon} />
            <Text style={[s.textBtnLabel, { color: '#8b5cf6' }]}>ASSIGN</Text>
          </TouchableOpacity>
        )}
        {user?.can_manage_staff && (
          <TouchableOpacity onPress={() => deleteMember(item)} style={s.textBtn}>
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
        title="Assistant Management" 
        subtitle="Manage operators & assistants" 
        onBack={() => navigation.goBack()} 
        rightAction={user?.can_manage_staff ? { icon: 'plus', onPress: openCreate } : null}
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
            placeholder="Search assistants..."
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

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} onRetry={() => loadStaff(true)} />}
      {loading ? (
        <ListSkeleton rows={5} />
      ) : (
        <FlatList
          data={filtered}
          renderItem={renderItem}
          keyExtractor={item => item.id.toString()}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadStaff(true)} tintColor={colors.brandLight} />}
          ListEmptyComponent={<View style={s.empty}><View style={s.emptyIcon}><FontAwesome5 name="users" size={24} color={colors.gray300} /></View><Text style={s.emptyTitle}>No assistants found</Text></View>}
        />
      )}

      {/* Filter Drawer */}
      <Modal visible={showFilter} transparent animationType="none" onRequestClose={() => setShowFilter(false)}>
        <View style={s.filterOverlay}>
          <TouchableOpacity style={s.filterBackdrop} activeOpacity={1} onPress={() => setShowFilter(false)} />
          <View style={s.filterDrawer}>
            <View style={s.filterHeader}>
              <Text style={s.filterTitle}>Filter Assistants</Text>
              <TouchableOpacity onPress={() => setShowFilter(false)} style={s.filterClose}><FontAwesome5 name="times" size={16} color={colors.gray400} /></TouchableOpacity>
            </View>
            <ScrollView style={s.filterContent}>
              <Text style={s.filterLabel}>ASSISTANT STATUS</Text>
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

      {/* Create/Edit Form Modal */}
      <Modal visible={showForm} animationType="slide" transparent onRequestClose={() => setShowForm(false)}>
        <View style={s.modalOverlay}>
          <TouchableOpacity style={s.modalBg} activeOpacity={1} onPress={() => setShowForm(false)} />
          <View style={s.modalSheet}>
            <View style={s.modalHandle} />
            <Text style={s.modalTitle}>{editingId ? 'Edit Assistant' : 'Add New Assistant'}</Text>
            <ScrollView style={s.formFields} keyboardShouldPersistTaps="handled">
              <View style={s.formRow}>
                <FormField label="FIRST NAME" value={form.first_name} onChangeText={t => setForm(p => ({ ...p, first_name: t }))} placeholder="First name" />
                <FormField label="LAST NAME" value={form.last_name} onChangeText={t => setForm(p => ({ ...p, last_name: t }))} placeholder="Last name" />
              </View>
              <FormField label="EMAIL" value={form.email} onChangeText={t => setForm(p => ({ ...p, email: t }))} placeholder="email@example.com" keyboardType="email-address" disabled={!!editingId} />
              <FormField label="PHONE" value={form.phone} onChangeText={t => setForm(p => ({ ...p, phone: t }))} placeholder="Phone number" keyboardType="phone-pad" />
              {!editingId && <FormField label="PASSWORD" value={form.password} onChangeText={t => setForm(p => ({ ...p, password: t }))} placeholder="Min 6 characters" secureTextEntry />}
            </ScrollView>
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
      </Modal>

      {/* Assignment Modal */}
      <Modal visible={showAssign} animationType="slide" transparent onRequestClose={() => setShowAssign(false)}>
        <View style={s.modalOverlay}>
          <TouchableOpacity style={s.modalBg} activeOpacity={1} onPress={() => setShowAssign(false)} />
          <View style={[s.modalSheet, { maxHeight: '80%' }]}>
            <View style={s.modalHandle} />
            <Text style={s.modalTitle}>Assign Access Scopes</Text>
            
            {loadingAssign ? (
              <ActivityIndicator size="large" color={colors.brandPrimary} style={{ marginVertical: 40 }} />
            ) : (
              <ScrollView style={s.assignContainer}>
                <Text style={s.sectionTitle}>Groups (Departments/Classes)</Text>
                <View style={s.checkGrid}>
                  {assignData.groups.map(g => (
                    <TouchableOpacity key={g.id} style={[s.checkItem, selectedGroupIds.includes(g.id) && s.checkItemActive]} onPress={() => toggleGroupSelection(g.id)}>
                      <FontAwesome5 name={selectedGroupIds.includes(g.id) ? "check-square" : "square"} size={14} color={selectedGroupIds.includes(g.id) ? colors.brandPrimary : colors.gray300} />
                      <Text style={[s.checkLabel, selectedGroupIds.includes(g.id) && s.checkLabelActive]} numberOfLines={1}>{g.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={s.sectionTitle}>Individual Tables (Sections)</Text>
                <View style={s.checkGrid}>
                  {assignData.tables.map(t => (
                    <TouchableOpacity key={t.id} style={[s.checkItem, selectedTableIds.includes(t.id) && s.checkItemActive]} onPress={() => toggleTableSelection(t.id)}>
                      <FontAwesome5 name={selectedTableIds.includes(t.id) ? "check-square" : "square"} size={14} color={selectedTableIds.includes(t.id) ? colors.brandPrimary : colors.gray300} />
                      <Text style={[s.checkLabel, selectedTableIds.includes(t.id) && s.checkLabelActive]} numberOfLines={1}>{t.name}</Text>
                    </TouchableOpacity>
                  ))}
                  {assignData.tables.length === 0 && <Text style={s.emptyLabel}>No tables available</Text>}
                </View>

                <Text style={s.sectionTitle}>Restrict to Specific Classes (Optional)</Text>
                <TextInput 
                  style={s.scopeInput} 
                  value={allowedClasses} 
                  onChangeText={setAllowedClasses} 
                  placeholder="e.g. 10th, 11th, 12th (comma separated)" 
                  placeholderTextColor={colors.gray300}
                />

                <Text style={s.sectionTitle}>Restrict to Specific Sections (Optional)</Text>
                <TextInput 
                  style={s.scopeInput} 
                  value={allowedSections} 
                  onChangeText={setAllowedSections} 
                  placeholder="e.g. A, B, C (comma separated)" 
                  placeholderTextColor={colors.gray300}
                />
              </ScrollView>
            )}

            <View style={s.formBtns}>
              <TouchableOpacity onPress={() => setShowAssign(false)} style={s.cancelBtn}><Text style={s.cancelBtnText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity onPress={saveAssignment} disabled={savingAssign || loadingAssign} style={s.saveBtnWrap}>
                <LinearGradient colors={gradients.brand} style={s.saveBtn}>
                  {savingAssign && <ActivityIndicator size="small" color="#fff" />}
                  <Text style={s.saveBtnText}>Save Assignments</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Toast visible={toast.visible} message={toast.message} type={toast.type} onHide={() => setToast(p => ({ ...p, visible: false }))} />

      <ConfirmModal 
        visible={confirmModal.visible}
        onClose={() => setConfirmModal(p => ({ ...p, visible: false }))}
        onConfirm={confirmModal.onConfirm}
        title={confirmModal.title}
        message={confirmModal.message}
        icon={confirmModal.icon}
        confirmColor={confirmModal.color}
        loading={loading && !refreshing}
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
  list: { padding: 16, paddingBottom: 32 },
  card: { backgroundColor: '#fff', borderRadius: radius.sm, borderWidth: 1, borderColor: '#f1f5f9', overflow: 'hidden', ...shadows.sm },
  cardTop: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  avatar: { width: 40, height: 40, borderRadius: radius.xs, backgroundColor: 'rgba(51,183,239,0.08)', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 13, fontWeight: '800', color: colors.brandPrimary },
  cardInfo: { flex: 1, minWidth: 0 },
  name: { fontSize: 14, fontFamily: fontFamily.bold, color: colors.gray800 },
  email: { fontSize: 11, color: colors.gray400, marginTop: 1, fontFamily: fontFamily.medium },
  statusPill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.sm, alignSelf: 'center' },
  statusDotSmall: { width: 6, height: 6, borderRadius: 3 },
  statusPillText: { fontSize: 9, fontFamily: fontFamily.bold, letterSpacing: 0.5 },
  cardActions: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingHorizontal: 10, paddingVertical: 10 },
  textBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 8, backgroundColor: '#f8fafc', borderRadius: radius.sm, borderWidth: 1, borderColor: '#f1f5f9' },
  btnIcon: { marginBottom: 1 },
  textBtnLabel: { fontSize: 10, fontFamily: fontFamily.bold, color: colors.brandPrimary, letterSpacing: 0.5 },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyIcon: { width: 64, height: 64, borderRadius: radius.xxl, backgroundColor: colors.gray100, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: 13, fontFamily: fontFamily.semibold, color: colors.gray400 },
  // Filter Drawer
  filterOverlay: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end' },
  filterBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15, 23, 42, 0.4)' },
  filterDrawer: { width: width * 0.75, height: '100%', backgroundColor: '#fff', paddingTop: 40 },
  filterHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  filterTitle: { fontSize: 16, fontFamily: fontFamily.bold, color: colors.gray800 },
  filterClose: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.gray50, alignItems: 'center', justifyContent: 'center' },
  filterContent: { flex: 1, padding: 20 },
  filterLabel: { fontSize: 10, fontWeight: '900', color: colors.gray400, letterSpacing: 1.2, marginBottom: 12 },
  filterChips: { flexDirection: 'row', flexWrap: 'wrap' },
  filterChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.sm, backgroundColor: colors.gray50, borderWidth: 1, borderColor: '#e2e8f0' },
  filterChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  filterChipText: { fontSize: 11, fontWeight: '700', color: colors.gray600 },
  filterChipTextActive: { color: '#fff' },
  filterFooter: { flexDirection: 'row', padding: 20, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
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
  formFields: { paddingHorizontal: 16 },
  formRow: { flexDirection: 'row' },
  field: { flex: 1 },
  fieldLabel: { fontSize: 10, fontWeight: '700', color: colors.gray500, letterSpacing: 0.8, marginBottom: 4 },
  fieldInput: { backgroundColor: colors.gray50, borderWidth: 1, borderColor: '#e2e8f0', borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: colors.gray700 },
  fieldDisabled: { backgroundColor: '#f1f5f9', color: colors.gray400 },
  formBtns: { flexDirection: 'row', paddingHorizontal: 16, marginTop: 16 },
  cancelBtn: { flex: 1, paddingVertical: 14, backgroundColor: colors.gray100, borderRadius: radius.md, alignItems: 'center' },
  cancelBtnText: { fontSize: 12, fontWeight: '600', color: colors.gray600 },
  saveBtnWrap: { flex: 2, borderRadius: radius.md, overflow: 'hidden' },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14 },
  saveBtnText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  // Assign
  assignContainer: { paddingHorizontal: 16, marginBottom: 16 },
  sectionTitle: { fontSize: 11, fontWeight: '800', color: colors.gray400, letterSpacing: 1, marginBottom: 12, marginTop: 8 },
  checkGrid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 20 },
  checkItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.gray50, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: '#e2e8f0', minWidth: '47%' },
  checkItemActive: { backgroundColor: 'rgba(51,183,239,0.05)', borderColor: colors.brandPrimary },
  checkLabel: { fontSize: 12, color: colors.gray600, flex: 1 },
  checkLabelActive: { color: colors.brandPrimary, fontWeight: '600' },
  emptyLabel: { fontSize: 12, color: colors.gray400, fontStyle: 'italic', paddingVertical: 10 },
  scopeInput: { 
    backgroundColor: colors.gray50, 
    borderWidth: 1, 
    borderColor: '#e2e8f0', 
    borderRadius: radius.md, 
    paddingHorizontal: 12, 
    paddingVertical: 10, 
    fontSize: 13, 
    color: colors.gray700,
    marginBottom: 16 
  },
});
