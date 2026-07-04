import React, { useState, useMemo, useCallback, useDeferredValue, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet, ActivityIndicator, RefreshControl, Modal, ScrollView, Dimensions, Switch } from 'react-native';
import { IconSearch, IconFilter, IconPlus, IconTrash, IconEdit, IconClose, IconCheck, IconMail, IconPhone, DynamicIcon } from '../components/Icons';
import { LinearGradient } from 'expo-linear-gradient';
import TopBar from '../components/TopBar';
import Toast from '../components/Toast';
import { StaffManageSkeleton } from '../components/Skeleton';
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
      : (isSuper || user?.role === 'admin_staff' || user?.role === 'client' || user?.role === 'guest_user' || (user?.permissions?.perm_manage_client_staff) || (user?.permissions?.perm_idcard_client_list));
      
    return {
      canManage,
      isSuper,
    };
  }, [user, isOperatorMode]);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', phone: '', password: '', department: '', designation: '', is_active: true });
  const [passOption, setPassOption] = useState('phone');
  const [tempPasswordUnlocked, setTempPasswordUnlocked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });

  const [showAssign, setShowAssign] = useState(false);
  const [assigningId, setAssigningId] = useState(null);
  const [assignData, setAssignData] = useState({ groups: [], tables: [], clients: [], class_section_options: {}, group_options: {}, table_options: {} });
  const [selectedGroupIds, setSelectedGroupIds] = useState([]);
  const [selectedTableIds, setSelectedTableIds] = useState([]);
  const [selectedClientIds, setSelectedClientIds] = useState([]);
  const [assignmentScopes, setAssignmentScopes] = useState([]);
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
    setForm({ first_name: '', last_name: '', email: '', phone: '', password: '', department: '', designation: '', is_active: true });
    setPassOption('phone');
    setTempPasswordUnlocked(false);
    setShowForm(true);
  };

  const openEdit = (member) => {
    setEditingId(member.id);
    const nameParts = (member.name || '').split(' ');
    setForm({ 
      first_name: nameParts[0] || '', 
      last_name: nameParts.slice(1).join(' ') || '', 
      email: member.email || '', 
      phone: member.phone || '', 
      password: '', 
      department: member.department || '', 
      designation: member.designation || '', 
      is_active: member.is_active ?? true 
    });
    setPassOption('custom');
    setTempPasswordUnlocked(false);
    setShowForm(true);
  };

  const saveStaff = async () => {
    if (!form.first_name || !form.email) {
      showToast('Please fill required fields (First Name & Email)', 'error'); return;
    }
    if (!editingId && passOption === 'phone' && !form.phone) {
      showToast('Phone number is required to use it as a password', 'error'); return;
    }
    if (!editingId && passOption === 'custom' && !form.password) {
      showToast('Password is required', 'error'); return;
    }
    setSaving(true);
    try {
      const url = editingId ? `/api/mobile/staff/${editingId}/update/` : '/api/mobile/staff/create/';
      const payload = {
        first_name: form.first_name,
        last_name: form.last_name,
        email: form.email,
        phone: form.phone,
        department: form.department,
        designation: form.designation,
        is_active: form.is_active,
        role: targetRole
      };
      
      if (!editingId) {
        if (passOption === 'phone') {
          payload.password = form.phone;
        } else {
          payload.password = form.password;
        }
      } else {
        if (tempPasswordUnlocked && form.password) {
          payload.temp_password = form.password;
        }
      }
      
      const { ok, data } = await apiPost(url, payload);
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
        
        // Initialize scopes and hydrate class_sections
        const scopes = (data.data.assignment_scopes || []).map(scope => {
          const type = scope.scope_type;
          const id = scope.scope_id;
          const optMap = type === 'group' ? data.data.group_options : data.data.table_options;
          const options = optMap?.[id] || { classes: [], sections: [], branches: [], class_sections: {} };
          const classSectionMap = options.class_sections || {};
          
          let classSections = {};
          if (scope.class_sections && Object.keys(scope.class_sections).length > 0) {
            Object.keys(scope.class_sections).forEach(cls => {
              classSections[cls] = [...(scope.class_sections[cls] || [])];
            });
          } else {
            // Build from flat classes and sections
            const selectedClasses = scope.classes || [];
            const selectedSections = scope.sections || [];
            selectedClasses.forEach(cls => {
              classSections[cls] = [];
            });
            selectedSections.forEach(sec => {
              let targetClass = null;
              selectedClasses.forEach(cls => {
                if (targetClass) return;
                const available = classSectionMap[cls] || [];
                if (available.includes(sec)) {
                  targetClass = cls;
                }
              });
              if (!targetClass && selectedClasses.length > 0) {
                targetClass = selectedClasses[0];
              }
              if (targetClass) {
                classSections[targetClass] = classSections[targetClass] || [];
                if (!classSections[targetClass].includes(sec)) {
                  classSections[targetClass].push(sec);
                }
              }
            });
          }
          
          return {
            ...scope,
            classes: scope.classes || [],
            sections: scope.sections || [],
            branches: scope.branches || [],
            class_sections: classSections
          };
        });
        setAssignmentScopes(scopes);
      }
    } catch (e) { showToast('Error loading assignments', 'error'); }
    setLoadingAssign(false);
  };

  const saveAssignment = async () => {
    setSavingAssign(true);
    try {
      const payload = {
        group_ids: selectedGroupIds,
        table_ids: selectedTableIds,
        client_ids: selectedClientIds,
        assignment_scopes: selectedGroupIds.map(gid => {
          const scope = assignmentScopes.find(s => s.scope_type === 'group' && parseInt(s.scope_id) === gid) || { classes: [], sections: [], branches: [], class_sections: {} };
          
          let classSections = {};
          if (scope.class_sections) {
            Object.keys(scope.class_sections).forEach(cls => {
              if (scope.class_sections[cls] && scope.class_sections[cls].length > 0) {
                classSections[cls] = scope.class_sections[cls];
              }
            });
          }
          if (Object.keys(classSections).length === 0 && (scope.classes || []).length > 0) {
            const optMap = assignData.group_options;
            const options = optMap?.[gid] || { classes: [], sections: [], branches: [], class_sections: {} };
            const classSectionMap = options.class_sections || {};
            (scope.classes || []).forEach(cls => {
              classSections[cls] = classSectionMap[cls] || [];
            });
          }
          
          return {
            scope_type: 'group',
            scope_id: gid,
            classes: scope.classes || [],
            sections: scope.sections || [],
            branches: scope.branches || [],
            class_sections: classSections
          };
        }).concat(selectedTableIds.map(tid => {
          const scope = assignmentScopes.find(s => s.scope_type === 'table' && parseInt(s.scope_id) === tid) || { classes: [], sections: [], branches: [], class_sections: {} };
          
          let classSections = {};
          if (scope.class_sections) {
            Object.keys(scope.class_sections).forEach(cls => {
              if (scope.class_sections[cls] && scope.class_sections[cls].length > 0) {
                classSections[cls] = scope.class_sections[cls];
              }
            });
          }
          if (Object.keys(classSections).length === 0 && (scope.classes || []).length > 0) {
            const optMap = assignData.table_options;
            const options = optMap?.[tid] || { classes: [], sections: [], branches: [], class_sections: {} };
            const classSectionMap = options.class_sections || {};
            (scope.classes || []).forEach(cls => {
              classSections[cls] = classSectionMap[cls] || [];
            });
          }
          
          return {
            scope_type: 'table',
            scope_id: tid,
            classes: scope.classes || [],
            sections: scope.sections || [],
            branches: scope.branches || [],
            class_sections: classSections
          };
        }))
      };
      
      const { ok, data } = await apiPost(`/api/mobile/staff/${assigningId}/assignment/update/`, payload);
      if (ok && data.success) { showToast('Assignments updated', 'success'); setShowAssign(false); }
      else showToast(data.message || 'Error saving', 'error');
    } catch (e) { showToast('Network error', 'error'); }
    setSavingAssign(false);
  };

  const renderScopeConfig = (item, type) => {
    const isGroup = type === 'group';
    const optMap = isGroup ? assignData.group_options : assignData.table_options;
    const options = optMap?.[item.id] || { classes: [], sections: [], branches: [], class_sections: {} };
    
    const scope = assignmentScopes.find(s => s.scope_type === type && parseInt(s.scope_id) === item.id) || { classes: [], sections: [], branches: [], class_sections: {} };
    
    const toggleValue = (field, val) => {
      setAssignmentScopes(prev => {
        const existingIdx = prev.findIndex(s => s.scope_type === type && parseInt(s.scope_id) === item.id);
        const currentScope = existingIdx > -1 ? { ...prev[existingIdx] } : { scope_type: type, scope_id: item.id, classes: [], sections: [], branches: [], class_sections: {} };
        
        const list = currentScope[field] || [];
        if (list.includes(val)) {
          currentScope[field] = list.filter(v => v !== val);
        } else {
          currentScope[field] = [...list, val];
        }
        
        if (existingIdx > -1) {
          const updated = [...prev];
          updated[existingIdx] = currentScope;
          return updated;
        } else {
          return [...prev, currentScope];
        }
      });
    };

    const toggleClassSection = (action, classVal, sectionVal = null) => {
      setAssignmentScopes(prev => {
        const existingIdx = prev.findIndex(s => s.scope_type === type && parseInt(s.scope_id) === item.id);
        const currentScope = existingIdx > -1 
          ? { ...prev[existingIdx] } 
          : { scope_type: type, scope_id: item.id, classes: [], sections: [], branches: [], class_sections: {} };
        
        if (!currentScope.class_sections) {
          currentScope.class_sections = {};
        } else {
          currentScope.class_sections = { ...currentScope.class_sections };
        }
        
        const availableSectionsForClass = options.class_sections?.[classVal] || [];
        
        if (action === 'class') {
          // Toggle entire class
          const currentSections = currentScope.class_sections[classVal] || [];
          const isAssigned = currentSections.length > 0 || (availableSectionsForClass.length === 0 && currentScope.classes?.includes(classVal));
          
          if (isAssigned) {
            // Deselect class and all its sections
            currentScope.class_sections[classVal] = [];
            currentScope.classes = (currentScope.classes || []).filter(c => c !== classVal);
          } else {
            // Select class and all its sections
            currentScope.class_sections[classVal] = [...availableSectionsForClass];
            if (!currentScope.classes?.includes(classVal)) {
              currentScope.classes = [...(currentScope.classes || []), classVal];
            }
          }
        } else if (action === 'section' && sectionVal) {
          // Toggle specific section under a class
          const currentSections = [...(currentScope.class_sections[classVal] || [])];
          if (currentSections.includes(sectionVal)) {
            currentScope.class_sections[classVal] = currentSections.filter(s => s !== sectionVal);
          } else {
            currentScope.class_sections[classVal] = [...currentSections, sectionVal];
          }
          
          const hasSelectedSections = currentScope.class_sections[classVal].length > 0;
          if (hasSelectedSections) {
            if (!currentScope.classes?.includes(classVal)) {
              currentScope.classes = [...(currentScope.classes || []), classVal];
            }
          } else {
            // If class has sections and none are selected, deselect class itself
            if (availableSectionsForClass.length > 0) {
              currentScope.classes = (currentScope.classes || []).filter(c => c !== classVal);
            }
          }
        }
        
        // Re-sync all sections list flatly in currentScope.sections
        const allFlatSections = [];
        const seenSections = new Set();
        Object.keys(currentScope.class_sections).forEach(cls => {
          (currentScope.class_sections[cls] || []).forEach(sec => {
            if (!seenSections.has(sec)) {
              seenSections.add(sec);
              allFlatSections.push(sec);
            }
          });
        });
        currentScope.sections = allFlatSections;
        
        if (existingIdx > -1) {
          const updated = [...prev];
          updated[existingIdx] = currentScope;
          return updated;
        } else {
          return [...prev, currentScope];
        }
      });
    };
    
    const classesList = options.classes || [];
    const branchesList = options.branches || [];
    
    if (classesList.length === 0 && branchesList.length === 0) {
      return null;
    }
    
    return (
      <View key={`${type}-${item.id}`} style={s.scopeCard}>
        <Text style={s.scopeCardTitle}>{item.name.toUpperCase()} FILTERS</Text>
        
        {classesList.length > 0 && (
          <View style={s.scopeSection}>
            <Text style={s.scopeSubTitle}>Class-Section Assignment Matrix</Text>
            <View style={s.matrixContainer}>
              {classesList.map(cls => {
                const availableSections = options.class_sections?.[cls] || [];
                const selectedSections = scope.class_sections?.[cls] || [];
                const isClassAssigned = selectedSections.length > 0 || (availableSections.length === 0 && scope.classes?.includes(cls));
                
                return (
                  <View key={cls} style={[s.matrixRow, isClassAssigned && s.matrixRowActive]}>
                    <View style={s.matrixClassCol}>
                      <TouchableOpacity 
                        activeOpacity={0.7} 
                        style={[s.matrixClassChip, isClassAssigned && s.matrixClassChipActive]} 
                        onPress={() => toggleClassSection('class', cls)}
                      >
                        <View style={[s.matrixCheckboxIcon, isClassAssigned && s.matrixCheckboxIconActive]}>
                          {isClassAssigned && <IconCheck size={10} color="#fff" />}
                        </View>
                        <Text style={[s.matrixClassLabel, isClassAssigned && s.matrixClassLabelActive]}>{cls}</Text>
                      </TouchableOpacity>
                    </View>
                    
                    <View style={s.matrixSectionsCol}>
                      {availableSections.length > 0 ? (
                        <View style={s.matrixSectionsGrid}>
                          {availableSections.map(sec => {
                            const isSecSelected = selectedSections.includes(sec);
                            return (
                              <TouchableOpacity 
                                key={sec} 
                                activeOpacity={0.7} 
                                style={[s.matrixSectionChip, isSecSelected && s.matrixSectionChipActive]} 
                                onPress={() => toggleClassSection('section', cls, sec)}
                              >
                                <Text style={[s.matrixSectionLabel, isSecSelected && s.matrixSectionLabelActive]}>{sec}</Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      ) : (
                        <Text style={s.matrixEmptyText}>No sections available</Text>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        )}
        
        {branchesList.length > 0 && (
          <View style={s.scopeSection}>
            <Text style={s.scopeSubTitle}>Branches / Courses</Text>
            <View style={s.checkGridSmall}>
              {branchesList.map(br => {
                const isSelected = scope.branches?.includes(br);
                return (
                  <TouchableOpacity key={br} style={[s.checkItemSmall, isSelected && s.checkItemSmallActive]} onPress={() => toggleValue('branches', br)}>
                    <Text style={[s.checkLabelSmall, isSelected && s.checkLabelSmallActive]}>{br}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}
      </View>
    );
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
            <LinearGradient colors={gradients.brand} style={s.addBtnInner}>
              <IconPlus size={14} color="#fff" style={{ marginRight: 6 }} />
              <Text style={s.addBtnText}>ADD NEW</Text>
            </LinearGradient>
          </TouchableOpacity>
        )}
      </View>

      {error ? <ErrorBanner message={error} onRetry={refresh} /> : loading && !refreshing ? <StaffManageSkeleton /> : (
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
              
              {/* Active Status Switch */}
              <View style={s.switchRow}>
                <Text style={s.switchLabel}>ACTIVE STATUS</Text>
                <Switch
                  value={form.is_active}
                  onValueChange={val => setForm(f => ({ ...f, is_active: val }))}
                  trackColor={{ false: '#cbd5e1', true: '#c7d2fe' }}
                  thumbColor={form.is_active ? colors.brandPrimary : '#94a3b8'}
                />
              </View>

              {/* Password configuration */}
              {!editingId ? (
                <View style={s.passOptionContainer}>
                  <Text style={s.optionGroupLabel}>PASSWORD SETUP</Text>
                  <View style={s.optionGrid}>
                    <TouchableOpacity 
                      style={[s.optionItem, passOption === 'phone' && s.optionItemActive]} 
                      onPress={() => setPassOption('phone')}
                    >
                      <Text style={[s.optionLabel, passOption === 'phone' && s.optionLabelActive]}>Use Phone as Password</Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={[s.optionItem, passOption === 'custom' && s.optionItemActive]} 
                      onPress={() => setPassOption('custom')}
                    >
                      <Text style={[s.optionLabel, passOption === 'custom' && s.optionLabelActive]}>Custom Password</Text>
                    </TouchableOpacity>
                  </View>
                  
                  {passOption === 'custom' && (
                    <FormField 
                      label="PASSWORD *" 
                      value={form.password} 
                      onChangeText={t => setForm(f => ({ ...f, password: t }))} 
                      secureTextEntry 
                    />
                  )}
                </View>
              ) : (
                <View style={s.tempPasswordContainer}>
                  {!tempPasswordUnlocked ? (
                    <TouchableOpacity 
                      style={s.unlockBtn} 
                      onPress={() => setTempPasswordUnlocked(true)}
                    >
                      <Text style={s.unlockBtnText}>Unlock Temporary Password</Text>
                    </TouchableOpacity>
                  ) : (
                    <View style={s.tempPasswordInputRow}>
                      <View style={{ flex: 1 }}>
                        <FormField 
                          label="NEW TEMPORARY PASSWORD *" 
                          value={form.password} 
                          onChangeText={t => setForm(f => ({ ...f, password: t }))} 
                          secureTextEntry 
                        />
                      </View>
                      <TouchableOpacity 
                        style={s.lockBtn} 
                        onPress={() => {
                          setTempPasswordUnlocked(false);
                          setForm(f => ({ ...f, password: '' }));
                        }}
                      >
                        <IconClose size={16} color="#ef4444" />
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              )}
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
                    
                    {selectedGroupIds.map(gid => {
                      const g = assignData.groups.find(x => x.id === gid);
                      return g ? renderScopeConfig(g, 'group') : null;
                    })}

                    <Text style={s.sectionTitle}>Tables (Sections)</Text>
                    <View style={s.checkGrid}>
                      {assignData.tables.map(t => (
                        <TouchableOpacity key={t.id} style={[s.checkItem, selectedTableIds.includes(t.id) && s.checkItemActive]} onPress={() => setSelectedTableIds(p => p.includes(t.id) ? p.filter(i => i !== t.id) : [...p, t.id])}>
                          <Text style={[s.checkLabel, selectedTableIds.includes(t.id) && s.checkLabelActive]} numberOfLines={1}>{t.name}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    {selectedTableIds.map(tid => {
                      const t = assignData.tables.find(x => x.id === tid);
                      return t ? renderScopeConfig(t, 'table') : null;
                    })}
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
  addBtn: { height: 44, borderRadius: radius.xs, ...shadows.md },
  addBtnInner: { flex: 1, borderRadius: radius.xs, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  addBtnText: { color: '#fff', fontSize: 12, fontFamily: 'SairaSemiCondensed-Bold' },
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
  modalContent: { backgroundColor: '#fff', borderTopLeftRadius: radius.sm, borderTopRightRadius: radius.sm, padding: 20, paddingBottom: 32, maxHeight: '90%' },
  modalContentFull: { backgroundColor: '#fff', borderTopLeftRadius: radius.sm, borderTopRightRadius: radius.sm, padding: 20, paddingBottom: 32 },
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

  // Password Setup & Status Switch Styles
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, paddingVertical: 4 },
  switchLabel: { fontSize: 11, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray500 },
  passOptionContainer: { marginBottom: 16 },
  optionGroupLabel: { fontSize: 11, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray500, marginBottom: 8 },
  optionGrid: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  optionItem: { flex: 1, paddingVertical: 10, paddingHorizontal: 12, borderRadius: radius.xs, borderWidth: 1, borderColor: '#e2e8f0', backgroundColor: colors.gray50, alignItems: 'center', justifyContent: 'center' },
  optionItemActive: { backgroundColor: 'rgba(102,126,234,0.1)', borderColor: colors.brandPrimary },
  optionLabel: { fontSize: 11, fontFamily: 'SairaSemiCondensed-Medium', color: colors.gray600, textAlign: 'center' },
  optionLabelActive: { fontFamily: 'SairaSemiCondensed-Bold', color: colors.brandPrimary },
  tempPasswordContainer: { marginBottom: 16 },
  unlockBtn: { paddingVertical: 12, borderRadius: radius.xs, borderStyle: 'dashed', borderWidth: 1, borderColor: colors.brandPrimary, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f3ff' },
  unlockBtnText: { fontSize: 12, fontFamily: 'SairaSemiCondensed-Bold', color: colors.brandPrimary },
  tempPasswordInputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  lockBtn: { width: 44, height: 44, borderRadius: radius.xs, backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fee2e2', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },

  // Scope Filtering Styles
  scopeCard: { backgroundColor: '#f8fafc', borderRadius: radius.xs, padding: 12, marginTop: 10, marginBottom: 15, borderWidth: 1, borderColor: '#e2e8f0', width: '100%' },
  scopeCardTitle: { fontSize: 11, fontFamily: 'SairaSemiCondensed-Bold', color: colors.brandPrimary, letterSpacing: 0.5, marginBottom: 10, textTransform: 'uppercase' },
  scopeSection: { marginBottom: 12 },
  scopeSubTitle: { fontSize: 10, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray400, marginBottom: 6, textTransform: 'uppercase' },
  checkGridSmall: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  checkItemSmall: { backgroundColor: '#fff', paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.xs, borderWidth: 1, borderColor: '#cbd5e1' },
  checkItemSmallActive: { backgroundColor: 'rgba(102,126,234,0.08)', borderColor: colors.brandPrimary },
  checkLabelSmall: { fontSize: 10, color: colors.gray600, fontFamily: 'SairaSemiCondensed-Medium' },
  checkLabelSmallActive: { color: colors.brandPrimary, fontFamily: 'SairaSemiCondensed-Bold' },

  // Matrix specific styles
  matrixContainer: { marginTop: 6, gap: 8 },
  matrixRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: radius.xs, borderWidth: 1, borderColor: '#e2e8f0', padding: 8, minHeight: 48 },
  matrixRowActive: { borderColor: colors.brandPrimary, backgroundColor: 'rgba(102,126,234,0.02)' },
  matrixClassCol: { width: '35%', borderRightWidth: 1, borderRightColor: '#f1f5f9', paddingRight: 8, justifyContent: 'center' },
  matrixClassChip: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 8, borderRadius: radius.xs, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#cbd5e1' },
  matrixClassChipActive: { backgroundColor: 'rgba(102,126,234,0.1)', borderColor: colors.brandPrimary },
  matrixCheckboxIcon: { width: 14, height: 14, borderRadius: 3, borderWidth: 1, borderColor: '#94a3b8', marginRight: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  matrixCheckboxIconActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  matrixClassLabel: { fontSize: 11, fontFamily: 'SairaSemiCondensed-Medium', color: colors.gray600 },
  matrixClassLabelActive: { fontFamily: 'SairaSemiCondensed-Bold', color: colors.brandPrimary },
  matrixSectionsCol: { width: '65%', paddingLeft: 8, justifyContent: 'center' },
  matrixSectionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  matrixSectionChip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.xs, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#fff' },
  matrixSectionChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  matrixSectionLabel: { fontSize: 10, fontFamily: 'SairaSemiCondensed-Medium', color: colors.gray600 },
  matrixSectionLabelActive: { fontFamily: 'SairaSemiCondensed-Bold', color: '#fff' },
  matrixEmptyText: { fontSize: 10, fontFamily: 'SairaSemiCondensed-Medium', color: colors.gray400, fontStyle: 'italic' },
});
