import React, { useState, useEffect, useMemo, useDeferredValue, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet, ActivityIndicator, Switch, RefreshControl, Modal, ScrollView, Dimensions, Linking, Image, TouchableWithoutFeedback } from 'react-native';
import { IconSearch, IconFilter, IconPlus, IconTrash, IconEdit, IconUsers, IconList, IconClose, IconCheck, IconMail, IconPhone, DynamicIcon } from '../components/Icons';
import { LinearGradient } from 'expo-linear-gradient';
import TopBar from '../components/TopBar';
import Toast from '../components/Toast';
import { ClientsListSkeleton } from '../components/Skeleton';
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
  const searchInputRef = React.useRef(null);
  
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', address: '', password: '', is_active: false });
  const [saving, setSaving] = useState(false);
  const [passOption, setPassOption] = useState('phone'); 
  const [tempPasswordUnlocked, setTempPasswordUnlocked] = useState(false);

  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });
  const [impersonatingId, setImpersonatingId] = useState(null);
  const [confirmModal, setConfirmModal] = useState({ 
    visible: false, title: '', message: '', icon: '', color: colors.brandPrimary, onConfirm: null 
  });
  const [verificationModal, setVerificationModal] = useState({
    visible: false, title: '', message: '', targetAction: null, targetData: null
  });
  const [generatedCode, setGeneratedCode] = useState('');
  const [enteredCode, setEnteredCode] = useState('');

  const showToast = (msg, type = 'info') => setToast({ visible: true, message: msg, type });

  const loadClients = useCallback(async () => {
    const { ok, data } = await apiGet('/api/mobile/clients/');
    if (ok && data?.success) return data.users || [];
    throw new Error(data?.message || 'Failed to load clients');
  }, []);

  const { data: clients = [], loading, refreshing, error, refresh, setData } = useRefreshableResource(loadClients, { initialData: [] });

  useEffect(() => {
    if (route.params?.openForm) openCreate();
    if (route.params?.focusSearch) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 300);
    }
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

  const generateCode = () => {
    return String(Math.floor(1000000000 + Math.random() * 9000000000));
  };

  const handleVerificationConfirm = async () => {
    const { targetAction, targetData } = verificationModal;
    setVerificationModal(p => ({ ...p, visible: false }));
    
    if (targetAction === 'delete') {
      const client = targetData;
      try {
        const { ok, data } = await apiPost(`/api/mobile/client/${client.id}/delete/`, {});
        if (ok && data?.success) { 
          showToast(data.message || 'Client deleted successfully', 'success'); 
          setData(prev => prev.filter(c => c.id !== client.id)); 
        } else {
          showToast(data?.message || 'Error deleting client', 'error');
        }
      } catch (e) { 
        showToast('Network error', 'error'); 
      }
    } else if (targetAction === 'unlock_temp_password') {
      setTempPasswordUnlocked(true);
      showToast('Temporary password field unlocked', 'success');
    }
  };

  const openCreate = useCallback(() => {
    setEditingId(null);
    setForm({ name: '', email: '', phone: '', address: '', password: '', is_active: false });
    setPassOption('phone');
    setTempPasswordUnlocked(false);
    setShowForm(true);
  }, []);

  const openEdit = useCallback((client) => {
    setEditingId(client.id);
    setForm({ 
      name: client.name || '', 
      email: client.email || '', 
      phone: client.phone || '', 
      address: client.address || '', 
      password: '', 
      is_active: client.is_active ?? false 
    });
    setPassOption('custom');
    setTempPasswordUnlocked(false);
    setShowForm(true);
  }, []);

  const saveClient = async () => {
    if (!form.name || !form.email) {
      showToast('Please fill required fields (Name & Email)', 'error');
      return;
    }
    if (!editingId && passOption === 'phone' && !form.phone) {
      showToast('Phone number is required to use it as a password', 'error');
      return;
    }
    setSaving(true);
    try {
      const url = editingId ? `/api/mobile/client/${editingId}/update/` : '/api/mobile/client/create/';
      const payload = {
        name: form.name,
        email: form.email,
        phone: form.phone,
        address: form.address,
        is_active: form.is_active,
      };
      
      if (!editingId) {
        if (passOption === 'phone') {
          payload.password = form.phone;
        } else if (form.password) {
          payload.password = form.password;
        }
      } else {
        if (tempPasswordUnlocked && form.password) {
          payload.temp_password = form.password;
        }
      }
      
      const { ok, data } = await apiPost(url, payload);
      if (ok && data.success) {
        showToast(editingId ? 'Client updated' : 'Client created', 'success');
        setShowForm(false);
        if (editingId) {
          setData(prev => prev.map(c => c.id === editingId ? { ...c, ...data.client } : c));
        } else {
          setData(prev => [data.client, ...prev]);
        }
      } else showToast(data.message || 'Error saving client', 'error');
    } catch (e) { showToast('Network error', 'error'); }
    setSaving(false);
  };

  const toggleClient = useCallback((client) => {
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
          if (ok && data.success) {
            showToast(data.message, 'success');
            setData(prev => prev.map(c => c.id === client.id ? { ...c, is_active: !c.is_active } : c));
          }
          else showToast(data.message || 'Error toggling client', 'error');
        } catch (e) { showToast('Network error', 'error'); }
      }
    });
  }, [showToast, setData]);

  const deleteClient = useCallback((client) => {
    const code = generateCode();
    setGeneratedCode(code);
    setEnteredCode('');
    setVerificationModal({
      visible: true,
      title: 'Delete Client?',
      message: `To permanently delete "${client.name}" and all associated tables/cards, please confirm by entering the 10-digit code.`,
      targetAction: 'delete',
      targetData: client,
    });
  }, []);

  const requestUnlockTempPassword = () => {
    const code = generateCode();
    setGeneratedCode(code);
    setEnteredCode('');
    setVerificationModal({
      visible: true,
      title: 'Unlock Security Fields?',
      message: 'Entering a temporary password requires security confirmation. Please confirm by entering the 10-digit code below.',
      targetAction: 'unlock_temp_password',
      targetData: null,
    });
  };

  const handleImpersonate = useCallback((client) => {
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
  }, [startImpersonation, navigation, showToast]);

  const handleCardPress = useCallback((item) => {
    navigation.navigate('ClientGroups', { clientId: item.id, clientName: item.name });
  }, [navigation]);

  const renderItem = useCallback(({ item }) => (
    <ClientCard
      item={item}
      perms={perms}
      impersonatingId={impersonatingId}
      onImpersonate={handleImpersonate}
      onEdit={openEdit}
      onDelete={deleteClient}
      onToggle={toggleClient}
      onCardPress={handleCardPress}
      navigation={navigation}
    />
  ), [perms, impersonatingId, handleImpersonate, openEdit, deleteClient, toggleClient, handleCardPress, navigation]);

  return (
    <View style={s.root}>
      <TopBar title="CLIENTS" onBack={() => navigation.goBack()} />
      <View style={s.searchSection}>
        <View style={s.searchBar}>
          <IconSearch size={14} color={colors.gray400} />
          <TextInput ref={searchInputRef} style={s.searchInput} value={search} onChangeText={setSearch} placeholder="Search clients..." placeholderTextColor={colors.gray400} />
        </View>
        {(perms.isSuperAdmin || perms.perm_idcard_client_list) && (
          <TouchableOpacity style={s.addBtn} onPress={openCreate}>
            <LinearGradient colors={gradients.brand} style={s.addBtnInner}><IconPlus size={16} color="#fff" /></LinearGradient>
          </TouchableOpacity>
        )}
      </View>

      {error ? <ErrorBanner message={error} onRetry={refresh} /> : loading && !refreshing ? <ClientsListSkeleton /> : (
        <FlatList data={filtered} renderItem={renderItem} keyExtractor={item => item.id.toString()} contentContainerStyle={s.list} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.brandPrimary} />} ListEmptyComponent={<View style={s.empty}><Text style={s.emptyText}>No clients found</Text></View>} />
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
              <FormField label="ADDRESS" value={form.address} onChangeText={t => setForm(f => ({ ...f, address: t }))} multiline numberOfLines={2} />
              
              {!editingId ? (
                <>
                  <View style={s.passOptionContainer}>
                    <Text style={s.fieldLabel}>PASSWORD SETUP</Text>
                    <View style={s.passOptionRow}>
                      <TouchableOpacity
                        style={[s.passOptionBtn, passOption === 'phone' && s.passOptionBtnActive]}
                        onPress={() => setPassOption('phone')}
                      >
                        <Text style={[s.passOptionBtnText, passOption === 'phone' && s.passOptionBtnTextActive]}>
                          Use Phone as Password
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[s.passOptionBtn, passOption === 'custom' && s.passOptionBtnActive]}
                        onPress={() => setPassOption('custom')}
                      >
                        <Text style={[s.passOptionBtnText, passOption === 'custom' && s.passOptionBtnTextActive]}>
                          Custom Password
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {passOption === 'custom' && (
                    <FormField 
                      label="PASSWORD" 
                      value={form.password} 
                      onChangeText={t => setForm(f => ({ ...f, password: t }))} 
                      secureTextEntry 
                    />
                  )}
                  
                  <View style={s.sectionHeader}>
                    <View style={s.sectionDivider} />
                    <Text style={s.sectionTitle}>SYSTEM SETTINGS</Text>
                    <View style={s.sectionDivider} />
                  </View>

                  <View style={s.switchRow}>
                    <Text style={s.switchLabel}>ACTIVE STATUS</Text>
                    <Switch 
                      value={form.is_active} 
                      onValueChange={v => setForm(f => ({ ...f, is_active: v }))} 
                      trackColor={{ false: '#e2e8f0', true: colors.brandPrimary }}
                      thumbColor={form.is_active ? '#fff' : '#f4f3f4'}
                    />
                  </View>
                </>
              ) : (
                <>
                  <View style={s.sectionHeader}>
                    <View style={s.sectionDivider} />
                    <Text style={s.sectionTitle}>SECURITY & SYSTEM SETTINGS</Text>
                    <View style={s.sectionDivider} />
                  </View>

                  <View style={s.switchRow}>
                    <Text style={s.switchLabel}>ACTIVE STATUS</Text>
                    <Switch 
                      value={form.is_active} 
                      onValueChange={v => setForm(f => ({ ...f, is_active: v }))} 
                      trackColor={{ false: '#e2e8f0', true: colors.brandPrimary }}
                      thumbColor={form.is_active ? '#fff' : '#f4f3f4'}
                    />
                  </View>

                  {tempPasswordUnlocked ? (
                    <FormField 
                      label="TEMP PASSWORD (OPTIONAL)" 
                      value={form.password} 
                      onChangeText={t => setForm(f => ({ ...f, password: t }))} 
                      secureTextEntry 
                    />
                  ) : (
                    <TouchableOpacity style={s.unlockBtn} onPress={requestUnlockTempPassword}>
                      <DynamicIcon name="lock" size={12} color={colors.gray600} />
                      <Text style={s.unlockBtnText}>Unlock Temporary Password</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}
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

      {/* Custom 10-Digit Verification Modal */}
      <Modal visible={verificationModal.visible} transparent animationType="fade" onRequestClose={() => setVerificationModal(p => ({ ...p, visible: false }))}>
        <View style={s.overlay}>
          <TouchableWithoutFeedback onPress={() => setVerificationModal(p => ({ ...p, visible: false }))}>
            <View style={s.backdrop} />
          </TouchableWithoutFeedback>
          <View style={s.verificationContent}>
            <View style={[s.iconCircleLarge, { backgroundColor: '#fee2e2', borderColor: '#fca5a5' }]}>
              <DynamicIcon name="shield-alt" size={28} color="#ef4444" />
            </View>
            <Text style={s.title}>{verificationModal.title}</Text>
            <Text style={s.message}>{verificationModal.message}</Text>
            
            <View style={s.codeContainer}>
              <Text style={s.codeLabel}>VERIFICATION CODE</Text>
              <View style={s.codeBox}>
                <Text style={s.codeText}>{generatedCode}</Text>
              </View>
            </View>
            
            <View style={s.inputContainer}>
              <Text style={s.inputLabel}>ENTER CODE TO CONFIRM</Text>
              <TextInput
                style={[s.codeInput, enteredCode === generatedCode && s.codeInputSuccess]}
                value={enteredCode}
                onChangeText={t => setEnteredCode(t.replace(/\D/g, '').slice(0, 10))}
                keyboardType="numeric"
                placeholder="10-digit code"
                placeholderTextColor={colors.gray300}
                textAlign="center"
              />
            </View>
            
            <View style={s.footer}>
              <TouchableOpacity onPress={() => setVerificationModal(p => ({ ...p, visible: false }))} style={s.cancelBtn}>
                <Text style={s.cancelText}>Cancel</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                onPress={handleVerificationConfirm}
                disabled={enteredCode !== generatedCode}
                activeOpacity={0.8}
                style={[s.confirmBtnWrap, enteredCode !== generatedCode && { opacity: 0.4 }]}
              >
                <LinearGradient
                  colors={[colors.brandPrimary, colors.brandPrimary]}
                  style={s.confirmBtn}
                >
                  <Text style={s.confirmText}>Confirm</Text>
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

const StatPill = React.memo(function StatPill({ label, count, color, onPress }) {
  if (onPress) {
    return (
      <TouchableOpacity 
        style={[s.statPill, { borderColor: color + '20', backgroundColor: color + '05' }]} 
        onPress={onPress}
        activeOpacity={0.7}
      >
        <Text style={[s.statLabel, { color }]}>{label}</Text>
        <Text style={[s.statCount, { color }]}>{count || 0}</Text>
      </TouchableOpacity>
    );
  }
  return (
    <View style={[s.statPill, { borderColor: color + '20', backgroundColor: color + '05' }]}>
      <Text style={[s.statLabel, { color }]}>{label}</Text>
      <Text style={[s.statCount, { color }]}>{count || 0}</Text>
    </View>
  );
});

const ClientCard = React.memo(({ item, perms, impersonatingId, onImpersonate, onEdit, onDelete, onToggle, onCardPress, navigation }) => {
  const handlePress = useCallback(() => onCardPress(item), [item, onCardPress]);
  const handleToggle = useCallback(() => onToggle(item), [item, onToggle]);
  
  const handlePendingPress = useCallback(() => navigation.navigate('ClientGroups', { clientId: item.id, clientName: item.name, initialStatus: 'pending' }), [item.id, item.name, navigation]);
  const handleVerifiedPress = useCallback(() => navigation.navigate('ClientGroups', { clientId: item.id, clientName: item.name, initialStatus: 'verified' }), [item.id, item.name, navigation]);
  const handleApprovedPress = useCallback(() => navigation.navigate('ClientGroups', { clientId: item.id, clientName: item.name, initialStatus: 'approved' }), [item.id, item.name, navigation]);
  const handleDownloadPress = useCallback(() => navigation.navigate('ClientGroups', { clientId: item.id, clientName: item.name, initialStatus: 'download' }), [item.id, item.name, navigation]);
  const handlePoolPress = useCallback(() => navigation.navigate('ClientGroups', { clientId: item.id, clientName: item.name, initialStatus: 'pool' }), [item.id, item.name, navigation]);

  const handleGroupsPress = useCallback(() => navigation.navigate('ClientGroups', { clientId: item.id, clientName: item.name }), [item.id, item.name, navigation]);
  const handleSettingsPress = useCallback(() => navigation.navigate('GroupSettings', { clientId: item.id, clientName: item.name }), [item.id, item.name, navigation]);
  
  const handleImpersonatePress = useCallback(() => onImpersonate(item), [item, onImpersonate]);
  const handleEditPress = useCallback(() => onEdit(item), [item, onEdit]);
  const handleDeletePress = useCallback(() => onDelete(item), [item, onDelete]);

  const isImpersonatingThisClient = impersonatingId === (item.user_id || item.id);

  return (
    <View style={s.card}>
      <TouchableOpacity style={s.cardTop} onPress={handlePress} activeOpacity={0.92}>
        <View style={s.logoCircle}>
          {item.logo_url ? (
            <Image
              source={{ uri: resolveAdarshImageUrl(item.logo_url), headers: { Cookie: getSessionCookies() } }}
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
          <Text style={s.doubleTapHint}>Tap to View Groups</Text>
        </View>
        <TouchableOpacity
          activeOpacity={(perms.isSuperAdmin || perms.perm_idcard_client_list) ? 0.7 : 1}
          disabled={!(perms.isSuperAdmin || perms.perm_idcard_client_list)}
          onPress={handleToggle}
          style={[s.statusPill, { backgroundColor: item.is_active ? '#ecfdf5' : '#fef2f2' }]}
        >
          <View style={[s.statusDotSmall, { backgroundColor: item.is_active ? '#10b981' : '#ef4444' }]} />
          <Text style={[s.statusPillText, { color: item.is_active ? '#065f46' : '#991b1b' }]}>{item.is_active ? 'ACTIVE' : 'INACTIVE'}</Text>
        </TouchableOpacity>
      </TouchableOpacity>
      
      <View style={s.cardStats}>
        <StatPill label="PENDING" count={item.counts?.pending} color="#f59e0b" onPress={handlePendingPress} />
        <StatPill label="VERIFIED" count={item.counts?.verified} color="#10b981" onPress={handleVerifiedPress} />
        <StatPill label="APPROVED" count={item.counts?.approved} color="#3b82f6" onPress={handleApprovedPress} />
        <StatPill label="DOWNLOAD" count={item.counts?.download} color="#8b5cf6" onPress={handleDownloadPress} />
        <StatPill label="POOL" count={item.counts?.pool} color="#ec4899" onPress={handlePoolPress} />
      </View>

      <View style={s.cardActions}>
        {(perms.isSuperAdmin || perms.perm_idcard_client_list) && (
          <TouchableOpacity style={s.actionBtn} onPress={handleGroupsPress}>
            <LinearGradient colors={['#f0fdf4', '#dcfce7']} style={s.actionBtnInner}>
              <DynamicIcon name="layer-group" size={12} color="#16a34a" style={s.actionIcon} /><Text style={[s.actionBtnText, { color: '#16a34a' }]}>GROUPS</Text>
            </LinearGradient>
          </TouchableOpacity>
        )}
        {(perms.isSuperAdmin || perms.perm_idcard_client_list) && (
          <TouchableOpacity style={s.actionBtn} onPress={handleSettingsPress}>
            <LinearGradient colors={['#f5f3ff', '#ede9fe']} style={s.actionBtnInner}>
              <DynamicIcon name="sliders-h" size={12} color="#7c3aed" style={s.actionIcon} /><Text style={[s.actionBtnText, { color: '#7c3aed' }]}>SETTING</Text>
            </LinearGradient>
          </TouchableOpacity>
        )}
        {(perms.isSuperAdmin || perms.perm_idcard_client_list) && (
          <TouchableOpacity style={s.actionBtn} onPress={handleImpersonatePress} disabled={isImpersonatingThisClient}>
            <LinearGradient colors={['#eff6ff', '#dbeafe']} style={s.actionBtnInner}>
              {isImpersonatingThisClient ? <ActivityIndicator size="small" color="#3b82f6" /> : <><DynamicIcon name="users" size={12} color="#3b82f6" style={s.actionIcon} /><Text style={[s.actionBtnText, { color: '#3b82f6' }]}>IMP.</Text></>}
            </LinearGradient>
          </TouchableOpacity>
        )}
        {(perms.isSuperAdmin || perms.perm_idcard_client_list) && (
          <TouchableOpacity style={s.actionBtn} onPress={handleEditPress}>
            <LinearGradient colors={['#f8fafc', '#f1f5f9']} style={s.actionBtnInner}>
              <DynamicIcon name="edit" size={12} color={colors.gray600} style={s.actionIcon} /><Text style={[s.actionBtnText, { color: colors.gray600 }]}>EDIT</Text>
            </LinearGradient>
          </TouchableOpacity>
        )}
        {perms.isSuperAdmin && (
          <TouchableOpacity style={s.actionBtn} onPress={handleDeletePress}>
            <LinearGradient colors={['#fef2f2', '#fee2e2']} style={s.actionBtnInner}>
              <DynamicIcon name="trash" size={12} color="#ef4444" style={s.actionIcon} /><Text style={[s.actionBtnText, { color: '#ef4444' }]}>DEL</Text>
            </LinearGradient>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
});

function FormField({ label, value, onChangeText, secureTextEntry, keyboardType, ...rest }) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput 
        style={[s.fieldInput, rest.multiline && { height: 60, paddingTop: 8, paddingBottom: 8, textAlignVertical: 'top' }]} 
        value={value} 
        onChangeText={onChangeText} 
        secureTextEntry={secureTextEntry} 
        keyboardType={keyboardType} 
        placeholderTextColor={colors.gray300} 
        {...rest}
      />
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
  card: { backgroundColor: '#fff', borderRadius: radius.sm, padding: 10, marginBottom: 14, ...shadows.sm, borderWidth: 1, borderColor: colors.gray100 },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  logoCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.gray50, alignItems: 'center', justifyContent: 'center', marginRight: 10, borderWidth: 1, borderColor: '#f1f5f9', overflow: 'hidden' },
  logo: { width: '100%', height: '100%', resizeMode: 'cover' },
  logoText: { fontSize: 16, fontFamily: 'SairaSemiCondensed-Bold', color: colors.brandPrimary },
  cardInfo: { flex: 1 },
  cardName: { fontSize: 14, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray800, marginBottom: 2 },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  contactText: { fontSize: 10, fontFamily: 'SairaSemiCondensed-Medium', color: colors.gray400 },
  doubleTapHint: { fontSize: 8, fontFamily: 'SairaSemiCondensed-Medium', color: colors.gray300, marginTop: 3 },
  cardStats: { flexDirection: 'row', gap: 4, marginTop: 10, justifyContent: 'space-between' },
  statPill: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, paddingVertical: 3, borderRadius: radius.xs, borderWidth: 1, justifyContent: 'space-between' },
  statLabel: { fontSize: 7, fontFamily: 'SairaSemiCondensed-Bold', letterSpacing: 0.2 },
  statCount: { fontSize: 10, fontFamily: 'SairaSemiCondensed-Bold', marginLeft: 2 },
  statusPill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.xs },
  statusDotSmall: { width: 5, height: 5, borderRadius: 2.5, marginRight: 4 },
  statusPillText: { fontSize: 8, fontFamily: 'SairaSemiCondensed-Bold' },
  cardActions: { flexDirection: 'row', gap: 8, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  actionBtn: { flex: 1, height: 32, borderRadius: radius.xs },
  actionBtnInner: { flex: 1, borderRadius: radius.xs, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  actionIcon: { marginRight: 6 },
  actionBtnText: { fontSize: 9, fontFamily: 'SairaSemiCondensed-Bold' },
  
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

  // Verification & Custom selector styles
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15, 23, 42, 0.75)' },
  iconCircleLarge: { width: 70, height: 70, borderRadius: radius.sm, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  title: { fontSize: 18, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray800, textAlign: 'center', marginBottom: 8 },
  message: { fontSize: 13, fontFamily: 'SairaSemiCondensed-Regular', color: colors.gray500, textAlign: 'center', lineHeight: 18, marginBottom: 16 },
  footer: { flexDirection: 'row', width: '100%', columnGap: 12 },
  cancelBtn: { flex: 1, paddingVertical: 14, borderRadius: radius.sm, backgroundColor: colors.gray100, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 13, fontFamily: 'SairaSemiCondensed-SemiBold', color: colors.gray600 },
  confirmBtnWrap: { flex: 1.5, borderRadius: radius.sm, overflow: 'hidden' },
  confirmBtn: { paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  confirmText: { fontSize: 13, fontFamily: 'SairaSemiCondensed-Bold', color: '#fff' },

  passOptionContainer: { marginBottom: 16 },
  passOptionRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  passOptionBtn: { flex: 1, paddingVertical: 10, paddingHorizontal: 6, borderRadius: radius.xs, borderWidth: 1, borderColor: colors.gray200, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  passOptionBtnActive: { borderColor: colors.brandPrimary, backgroundColor: `${colors.brandPrimary}08` },
  passOptionBtnText: { fontSize: 11, fontFamily: 'SairaSemiCondensed-Medium', color: colors.gray600, textAlign: 'center' },
  passOptionBtnTextActive: { fontFamily: 'SairaSemiCondensed-Bold', color: colors.brandPrimary },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginVertical: 20 },
  sectionDivider: { flex: 1, height: 1, backgroundColor: colors.gray200 },
  sectionTitle: { fontSize: 10, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray400, marginHorizontal: 10, letterSpacing: 0.5 },
  unlockBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc', borderWidth: 1.5, borderColor: colors.gray200, borderStyle: 'dashed', borderRadius: radius.xs, paddingVertical: 12, marginBottom: 16 },
  unlockBtnText: { fontSize: 12, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray600, marginLeft: 8 },

  verificationContent: { 
    width: '100%', 
    maxWidth: 340, 
    backgroundColor: '#fff', 
    borderRadius: radius.sm, 
    padding: 24, 
    alignItems: 'center',
    ...shadows.xl 
  },
  codeContainer: { alignItems: 'center', marginBottom: 16, width: '100%' },
  codeLabel: { fontSize: 9, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray400, marginBottom: 4, letterSpacing: 0.5 },
  codeBox: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: colors.gray200, paddingVertical: 10, paddingHorizontal: 16, borderRadius: radius.xs, width: '100%', alignItems: 'center', justifyContent: 'center' },
  codeText: { fontSize: 20, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray800, letterSpacing: 4 },
  inputContainer: { width: '100%', marginBottom: 24 },
  inputLabel: { fontSize: 9, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray500, marginBottom: 6, letterSpacing: 0.5, textAlign: 'center' },
  codeInput: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: colors.gray200, borderRadius: radius.xs, height: 46, fontSize: 16, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray800, width: '100%' },
  codeInputSuccess: { borderColor: '#10b981', backgroundColor: '#f0fdf4' },
});
