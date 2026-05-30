import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ScrollView, TextInput, Modal, ActivityIndicator,
  RefreshControl, Alert, Animated, Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DynamicIcon, IconPlus, IconClose, IconEdit, IconTrash } from '../components/Icons';
import TopBar from '../components/TopBar';
import Toast from '../components/Toast';
import ConfirmModal from '../components/ConfirmModal';
import { ListSkeleton } from '../components/Skeleton';
import { ErrorBanner } from '../components/NetworkGuard';
import { apiGet, apiPost } from '../api/client';
import { colors, gradients, shadows, radius } from '../theme';
import { useAuth } from '../context/AuthContext';
import useRefreshableResource from '../hooks/useRefreshableResource';

const { width } = Dimensions.get('window');

// Field type definitions matching web implementation exactly
const FIELD_TYPES = [
  { key: 'text',          label: 'Text',           icon: 'font',          color: '#3b82f6' },
  { key: 'email',         label: 'Email',          icon: 'envelope',      color: '#06b6d4' },
  { key: 'number',        label: 'Number',         icon: 'hashtag',       color: '#8b5cf6' },
  { key: 'date',          label: 'Date',           icon: 'calendar',      color: '#f59e0b' },
  { key: 'select',        label: 'Select',         icon: 'list-ul',       color: '#10b981' },
  { key: 'photo',         label: 'Photo',          icon: 'camera',        color: '#ec4899',  autoName: 'PHOTO' },
  { key: 'rel_photo',     label: 'Relation Photo', icon: 'user-friends',  color: '#a855f7' },
  { key: 'signature',     label: 'Signature',      icon: 'pen-nib',       color: '#6366f1',  autoName: 'SIGNATURE' },
  { key: 'qr_code',       label: 'QR Code',        icon: 'qrcode',        color: '#14b8a6',  autoName: 'QR CODE' },
  { key: 'barcode',       label: 'Barcode',        icon: 'barcode',       color: '#f97316',  autoName: 'BARCODE' },
  { key: 'class_section', label: 'Class & Section', icon: 'graduation-cap', color: '#84cc16', autoName: 'CLASS & SECTION' },
  { key: 'class',         label: 'Class',          icon: 'graduation-cap', color: '#84cc16' },
  { key: 'section',       label: 'Section',        icon: 'users',         color: '#10b981' },
  { key: 'image',         label: 'Image',          icon: 'image',         color: '#ec4899' },
  { key: 'textarea',      label: 'Text Area',      icon: 'align-left',    color: '#3b82f6' },
];

const STATUS_COLORS = {
  pending:  { bg: '#fffbeb', text: '#f59e0b', label: 'P' },
  verified: { bg: '#ecfdf5', text: '#10b981', label: 'V' },
  approved: { bg: '#eff6ff', text: '#3b82f6', label: 'A' },
  download: { bg: '#f5f3ff', text: '#8b5cf6', label: 'D' },
  pool:     { bg: '#fef2f2', text: '#ef4444', label: 'X' },
};

export default function GroupSettingsScreen({ navigation, route }) {
  const { clientId, clientName } = route?.params || {};
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  const isSuperAdmin = user?.role === 'super_admin' || user?.isSuperAdmin;
  const canEdit = isSuperAdmin || !!(user?.permissions?.perm_idcard_setting_edit);
  const canAdd = isSuperAdmin || !!(user?.permissions?.perm_idcard_setting_add);
  const canDelete = isSuperAdmin || !!(user?.permissions?.perm_idcard_setting_delete);

  // ── State ────────────────────────────────────────────────────────────────
  const [searchText, setSearchText] = useState('');
  const [expandedTableId, setExpandedTableId] = useState(null);

  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });
  const [confirmModal, setConfirmModal] = useState({ visible: false, title: '', message: '', icon: '', color: colors.brandPrimary, onConfirm: null });

  // Group modals
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [editingGroup, setEditingGroup] = useState(null); // null = create
  const [groupName, setGroupName] = useState('');
  const [groupSaving, setGroupSaving] = useState(false);

  // Table modals
  const [showTableModal, setShowTableModal] = useState(false);
  const [tableModalGroupId, setTableModalGroupId] = useState(null);
  const [editingTable, setEditingTable] = useState(null);
  const [tableName, setTableName] = useState('');
  const [tableSaving, setTableSaving] = useState(false);

  // Field editor modal
  const [showFieldEditor, setShowFieldEditor] = useState(false);
  const [fieldEditorTable, setFieldEditorTable] = useState(null);
  const [fields, setFields] = useState([]);
  const [fieldsSaving, setFieldsSaving] = useState(false);
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldType, setNewFieldType] = useState('text');
  const [newFieldMandatory, setNewFieldMandatory] = useState(false);
  const [newFieldNameLocked, setNewFieldNameLocked] = useState(false);

  // Auto-name logic matching web: when selecting image/special types, auto-fill name and lock
  const handleFieldTypeChange = (typeKey) => {
    setNewFieldType(typeKey);
    const ft = FIELD_TYPES.find(x => x.key === typeKey);
    if (ft?.autoName) {
      setNewFieldName(ft.autoName);
      setNewFieldNameLocked(true);
    } else {
      if (newFieldNameLocked) setNewFieldName('');
      setNewFieldNameLocked(false);
    }
  };

  const showToast = useCallback((msg, type = 'info') => setToast({ visible: true, message: msg, type }), []);

  // ── Data loading ──────────────────────────────────────────────────────────
  const loadGroups = useCallback(async () => {
    const { ok, data } = await apiGet(`/api/mobile/client/${clientId}/groups/`);
    if (ok && data?.success) return data.groups || [];
    throw new Error(data?.message || 'Failed to load groups');
  }, [clientId]);

  const { data: groups = [], loading, refreshing, error, refresh, setData: setGroups } = useRefreshableResource(loadGroups, { initialData: [] });

  const filteredGroups = useMemo(() => {
    if (!searchText) return groups;
    const query = searchText.toLowerCase();
    return groups.map(g => {
      if (g.name.toLowerCase().includes(query)) return g;
      const matchingTables = (g.tables || []).filter(t => t.name.toLowerCase().includes(query));
      if (matchingTables.length > 0) {
        return { ...g, tables: matchingTables };
      }
      return null;
    }).filter(Boolean);
  }, [groups, searchText]);

  // ── Group actions ─────────────────────────────────────────────────────────
  const openCreateGroup = () => {
    setEditingGroup(null);
    setGroupName('');
    setShowGroupModal(true);
  };

  const openEditGroup = (group) => {
    setEditingGroup(group);
    setGroupName(group.name);
    setShowGroupModal(true);
  };

  const saveGroup = async () => {
    const name = groupName.trim();
    if (!name) { showToast('Group name is required', 'error'); return; }
    setGroupSaving(true);
    try {
      let res;
      if (editingGroup) {
        res = await apiPost(`/api/mobile/group/${editingGroup.id}/update/`, { name });
      } else {
        res = await apiPost(`/api/mobile/client/${clientId}/group/create/`, { name });
      }
      const { ok, data } = res;
      if (ok && data?.success) {
        showToast(data.message || 'Saved', 'success');
        setShowGroupModal(false);
        if (editingGroup) {
          setGroups(prev => prev.map(g => g.id === editingGroup.id ? { ...g, name } : g));
        } else {
          setGroups(prev => [...prev, data.group]);
        }
      } else {
        showToast(data?.message || 'Error', 'error');
      }
    } catch { showToast('Network error', 'error'); }
    setGroupSaving(false);
  };

  const deleteGroup = (group) => {
    setConfirmModal({
      visible: true,
      title: 'Delete Group?',
      message: `Delete "${group.name}"? This only works if all tables inside are deleted first.`,
      icon: 'trash',
      color: '#ef4444',
      onConfirm: async () => {
        setConfirmModal(p => ({ ...p, visible: false }));
        const { ok, data } = await apiPost(`/api/mobile/group/${group.id}/delete/`, {});
        if (ok && data?.success) {
          showToast(data.message || 'Deleted', 'success');
          setGroups(prev => prev.filter(g => g.id !== group.id));
        } else {
          showToast(data?.message || 'Error deleting group', 'error');
        }
      },
    });
  };

  // ── Table actions ─────────────────────────────────────────────────────────
  const openCreateTable = (groupId) => {
    setTableModalGroupId(groupId);
    setEditingTable(null);
    setTableName('');
    setShowTableModal(true);
  };

  const openRenameTable = (table) => {
    setEditingTable(table);
    setTableName(table.name);
    setTableModalGroupId(table.group_id);
    setShowTableModal(true);
  };

  const saveTable = async () => {
    const name = tableName.trim();
    if (!name) { showToast('Table name is required', 'error'); return; }
    setTableSaving(true);
    try {
      let res;
      if (editingTable) {
        res = await apiPost(`/api/mobile/table/${editingTable.id}/rename/`, { name });
      } else {
        res = await apiPost(`/api/mobile/group/${tableModalGroupId}/table/create/`, { name });
      }
      const { ok, data } = res;
      if (ok && data?.success) {
        showToast(data.message || 'Saved', 'success');
        setShowTableModal(false);
        if (editingTable) {
          setGroups(prev => prev.map(g => ({
            ...g,
            tables: g.tables.map(t => t.id === editingTable.id ? { ...t, name } : t),
          })));
        } else {
          setGroups(prev => prev.map(g => {
            if (g.id !== tableModalGroupId) return g;
            return { ...g, tables: [...(g.tables || []), data.table], table_count: (g.table_count || 0) + 1 };
          }));
        }
      } else {
        showToast(data?.message || 'Error', 'error');
      }
    } catch { showToast('Network error', 'error'); }
    setTableSaving(false);
  };

  const deleteTable = (table) => {
    setConfirmModal({
      visible: true,
      title: 'Delete Table?',
      message: `Delete "${table.name}"? Only empty tables (0 cards) can be deleted.`,
      icon: 'trash',
      color: '#ef4444',
      onConfirm: async () => {
        setConfirmModal(p => ({ ...p, visible: false }));
        const { ok, data } = await apiPost(`/api/mobile/table/${table.id}/delete/`, {});
        if (ok && data?.success) {
          showToast(data.message || 'Deleted', 'success');
          setGroups(prev => prev.map(g => ({
            ...g,
            tables: g.tables.filter(t => t.id !== table.id),
            table_count: Math.max(0, (g.table_count || 1) - 1),
          })));
        } else {
          showToast(data?.message || data?.message || 'Error', 'error');
        }
      },
    });
  };

  // ── Field editor ──────────────────────────────────────────────────────────
  const openFieldEditor = async (table) => {
    setFieldEditorTable(table);
    setFields(table.fields || []);
    setNewFieldName('');
    setNewFieldType('text');
    setNewFieldMandatory(false);
    setNewFieldNameLocked(false);
    setShowFieldEditor(true);
  };

  const addField = () => {
    const name = newFieldName.trim().toUpperCase();
    if (!name) { showToast('Field name required', 'error'); return; }
    if (fields.some(f => f.name.toUpperCase() === name)) {
      showToast('A field with this name already exists', 'error'); return;
    }
    if (fields.length >= 30) { showToast('Maximum 30 fields allowed', 'error'); return; }
    setFields(prev => [...prev, { name, type: newFieldType, order: prev.length, mandatory: newFieldMandatory }]);
    setNewFieldName('');
    setNewFieldType('text');
    setNewFieldMandatory(false);
    setNewFieldNameLocked(false);
  };

  const removeField = (index) => {
    setFields(prev => prev.filter((_, i) => i !== index));
  };

  const moveFieldUp = (index) => {
    if (index === 0) return;
    setFields(prev => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next.map((f, i) => ({ ...f, order: i }));
    });
  };

  const moveFieldDown = (index) => {
    setFields(prev => {
      if (index >= prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next.map((f, i) => ({ ...f, order: i }));
    });
  };

  const toggleMandatory = (index) => {
    setFields(prev => prev.map((f, i) => i === index ? { ...f, mandatory: !f.mandatory } : f));
  };

  const saveFields = async () => {
    if (!fieldEditorTable) return;
    setFieldsSaving(true);
    try {
      const { ok, data } = await apiPost(
        `/api/mobile/table/${fieldEditorTable.id}/update-fields/`,
        { fields: fields.map((f, i) => ({ ...f, order: i })) }
      );
      if (ok && data?.success) {
        showToast('Fields saved', 'success');
        setShowFieldEditor(false);
        setGroups(prev => prev.map(g => ({
          ...g,
          tables: (g.tables || []).map(t =>
            t.id === fieldEditorTable.id ? { ...t, fields } : t
          ),
        })));
      } else {
        showToast(data?.message || 'Error saving fields', 'error');
      }
    } catch { showToast('Network error', 'error'); }
    setFieldsSaving(false);
  };

  // ── Render helpers ────────────────────────────────────────────────────────
  const renderTableRow = (table, groupId) => {
    const isOpen = expandedTableId === table.id;
    const totalCards = table.total_count || 0;
    return (
      <View key={table.id} style={s.tableCard}>
        <TouchableOpacity
          style={s.tableHeader}
          onPress={() => setExpandedTableId(isOpen ? null : table.id)}
          activeOpacity={0.7}
        >
          <View style={s.tableIconCircle}>
            <DynamicIcon name="table" size={11} color="#8b5cf6" />
          </View>
          <View style={s.tableInfo}>
            <Text style={s.tableName} numberOfLines={1}>{table.name}</Text>
            <Text style={s.tableMeta}>{table.fields?.length || 0} fields · {totalCards} cards</Text>
          </View>
          <View style={s.tableStatusRow}>
            {['pending', 'verified', 'approved', 'download', 'pool'].map(st => {
              const count = table[`${st}_count`] || 0;
              if (!count) return null;
              const sc = STATUS_COLORS[st];
              return (
                <View key={st} style={[s.miniStatBadge, { backgroundColor: sc.bg }]}>
                  <Text style={[s.miniStatText, { color: sc.text }]}>{count}</Text>
                </View>
              );
            })}
          </View>
          <DynamicIcon name={isOpen ? 'chevron-up' : 'chevron-down'} size={10} color={colors.gray400} />
        </TouchableOpacity>

        {isOpen && (
          <View style={s.tableExpanded}>
            {/* Actions row */}
            <View style={s.tableActions}>
              {canEdit && (
                <TouchableOpacity style={s.tableAction} onPress={() => openFieldEditor(table)}>
                  <DynamicIcon name="columns" size={11} color="#10b981" />
                  <Text style={[s.tableActionText, { color: '#10b981' }]}>EDIT FIELDS</Text>
                </TouchableOpacity>
              )}
              {canEdit && (
                <TouchableOpacity style={s.tableAction} onPress={() => openRenameTable(table)}>
                  <IconEdit size={11} color="#f59e0b" />
                  <Text style={[s.tableActionText, { color: '#f59e0b' }]}>RENAME</Text>
                </TouchableOpacity>
              )}
              {canDelete && (
                <TouchableOpacity style={s.tableAction} onPress={() => deleteTable(table)}>
                  <IconTrash size={11} color="#ef4444" />
                  <Text style={[s.tableActionText, { color: '#ef4444' }]}>DELETE</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Fields preview */}
            {table.fields && table.fields.length > 0 ? (
              <View style={s.fieldsPreview}>
                <Text style={s.fieldsPreviewTitle}>FIELDS ({table.fields.length})</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.fieldChipsRow}>
                  {table.fields.map((f, i) => {
                    const ft = FIELD_TYPES.find(x => x.key === f.type) || FIELD_TYPES[0];
                    return (
                      <View key={i} style={[s.fieldChip, { borderColor: ft.color + '40', backgroundColor: ft.color + '10' }]}>
                        <DynamicIcon name={ft.icon} size={9} color={ft.color} />
                        <Text style={[s.fieldChipText, { color: ft.color }]} numberOfLines={1}>{f.name}</Text>
                        {f.mandatory && <View style={[s.mandatoryDot, { backgroundColor: ft.color }]} />}
                      </View>
                    );
                  })}
                </ScrollView>
              </View>
            ) : (
              <View style={s.noFieldsRow}>
                <DynamicIcon name="columns" size={14} color={colors.gray300} />
                <Text style={s.noFieldsText}>No fields defined — tap Edit Fields to add columns</Text>
              </View>
            )}
          </View>
        )}
      </View>
    );
  };

  const renderGroup = ({ item: group }) => {
    return (
      <View style={s.groupCard}>
        {/* Group header */}
        <View style={s.groupHeader}>
          <LinearGradient colors={['#7c3aed', '#4f46e5']} style={s.groupIconCircle}>
            <DynamicIcon name="layer-group" size={14} color="#fff" />
          </LinearGradient>
          <View style={s.groupInfo}>
            <Text style={s.groupName} numberOfLines={1}>{group.name}</Text>
            <Text style={s.groupMeta}>{group.table_count} tables · {group.total_cards} cards</Text>
          </View>
          {canEdit && (
            <TouchableOpacity
              style={s.groupEditBtnText}
              onPress={() => openEditGroup(group)}
            >
              <Text style={s.groupEditText}>EDIT</Text>
            </TouchableOpacity>
          )}
          {canDelete && (
            <TouchableOpacity
              style={s.groupDeleteBtnText}
              onPress={() => deleteGroup(group)}
            >
              <Text style={s.groupDeleteText}>DELETE</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Group body */}
        <View style={s.groupBody}>
          {(group.tables || []).map(t => renderTableRow(t, group.id))}
          {(group.tables || []).length === 0 && (
            <View style={s.emptyTables}>
              <DynamicIcon name="table" size={18} color={colors.gray300} />
              <Text style={s.emptyTablesText}>No tables in this group</Text>
            </View>
          )}
          {canAdd && (
            <TouchableOpacity style={s.addTableBtn} onPress={() => openCreateTable(group.id)} activeOpacity={0.7}>
              <LinearGradient colors={['#f5f3ff', '#ede9fe']} style={s.addTableBtnInner}>
                <IconPlus size={12} color="#7c3aed" />
                <Text style={s.addTableBtnText}>ADD TABLE</Text>
              </LinearGradient>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={s.root}>
      <TopBar
        title={clientName || 'Group Settings'}
        subtitle="Groups & Tables"
        onBack={() => navigation.goBack()}
        onAdd={canAdd ? openCreateGroup : undefined}
      />

      {error && <ErrorBanner message={error} onRetry={refresh} />}

      {loading ? (
        <ListSkeleton rows={5} />
      ) : (
        <FlatList
          data={filteredGroups}
          renderItem={renderGroup}
          keyExtractor={g => g.id.toString()}
          contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.brandPrimary} />}
          ListHeaderComponent={
            <View style={s.searchSection}>
              <View style={s.searchBar}>
                <DynamicIcon name="search" size={13} color={colors.gray400} />
                <TextInput
                  style={s.searchInput}
                  value={searchText}
                  onChangeText={setSearchText}
                  placeholder="Search groups or tables..."
                  placeholderTextColor={colors.gray400}
                  clearButtonMode="while-editing"
                />
              </View>
            </View>
          }
          ListEmptyComponent={
            <View style={s.empty}>
              <View style={s.emptyIcon}>
                <DynamicIcon name="layer-group" size={28} color={colors.gray300} />
              </View>
              <Text style={s.emptyTitle}>No Groups Yet</Text>
              <Text style={s.emptySub}>Tap the + button to create your first group</Text>
              {canAdd && (
                <TouchableOpacity style={s.emptyAddBtn} onPress={openCreateGroup}>
                  <LinearGradient colors={gradients.brand} style={s.emptyAddBtnInner}>
                    <IconPlus size={14} color="#fff" />
                    <Text style={s.emptyAddBtnText}>CREATE GROUP</Text>
                  </LinearGradient>
                </TouchableOpacity>
              )}
            </View>
          }
        />
      )}

      {/* ── Group Modal ───────────────────────────────────────────────────── */}
      <Modal visible={showGroupModal} animationType="slide" transparent onRequestClose={() => setShowGroupModal(false)}>
        <View style={s.modalOverlay}>
          <TouchableOpacity style={s.modalBg} activeOpacity={1} onPress={() => setShowGroupModal(false)} />
          <View style={s.modalSheet}>
            <View style={s.sheetHandle} />
            <View style={s.modalHeader}>
              <View style={s.modalTitleRow}>
                <LinearGradient colors={['#7c3aed', '#4f46e5']} style={s.modalIconCircle}>
                  <DynamicIcon name="layer-group" size={14} color="#fff" />
                </LinearGradient>
                <Text style={s.modalTitle}>{editingGroup ? 'Rename Group' : 'New Group'}</Text>
              </View>
              <TouchableOpacity onPress={() => setShowGroupModal(false)}>
                <IconClose size={20} color={colors.gray400} />
              </TouchableOpacity>
            </View>
            <Text style={s.inputLabel}>GROUP NAME *</Text>
            <TextInput
              style={s.textInput}
              value={groupName}
              onChangeText={setGroupName}
              placeholder="e.g. Batch 2024"
              placeholderTextColor={colors.gray300}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={saveGroup}
            />
            <View style={s.modalFooter}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setShowGroupModal(false)}>
                <Text style={s.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.saveBtn} onPress={saveGroup} disabled={groupSaving}>
                <LinearGradient colors={gradients.brand} style={s.saveBtnInner}>
                  {groupSaving
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={s.saveText}>{editingGroup ? 'RENAME' : 'CREATE GROUP'}</Text>}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Table Name Modal ──────────────────────────────────────────────── */}
      <Modal visible={showTableModal} animationType="slide" transparent onRequestClose={() => setShowTableModal(false)}>
        <View style={s.modalOverlay}>
          <TouchableOpacity style={s.modalBg} activeOpacity={1} onPress={() => setShowTableModal(false)} />
          <View style={s.modalSheet}>
            <View style={s.sheetHandle} />
            <View style={s.modalHeader}>
              <View style={s.modalTitleRow}>
                <View style={[s.modalIconCircle, { backgroundColor: '#7c3aed' }]}>
                  <DynamicIcon name="table" size={14} color="#fff" />
                </View>
                <Text style={s.modalTitle}>{editingTable ? 'Rename Table' : 'New Table'}</Text>
              </View>
              <TouchableOpacity onPress={() => setShowTableModal(false)}>
                <IconClose size={20} color={colors.gray400} />
              </TouchableOpacity>
            </View>
            <Text style={s.inputLabel}>TABLE NAME *</Text>
            <TextInput
              style={s.textInput}
              value={tableName}
              onChangeText={setTableName}
              placeholder="e.g. Class X - Section A"
              placeholderTextColor={colors.gray300}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={saveTable}
            />
            <View style={s.modalFooter}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setShowTableModal(false)}>
                <Text style={s.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.saveBtn} onPress={saveTable} disabled={tableSaving}>
                <LinearGradient colors={gradients.brand} style={s.saveBtnInner}>
                  {tableSaving
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={s.saveText}>{editingTable ? 'RENAME' : 'CREATE TABLE'}</Text>}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Field Editor Modal ────────────────────────────────────────────── */}
      <Modal visible={showFieldEditor} animationType="slide" transparent onRequestClose={() => setShowFieldEditor(false)}>
        <View style={s.fieldEditorOverlay}>
          <TouchableOpacity style={s.modalBg} activeOpacity={1} onPress={() => setShowFieldEditor(false)} />
          <View style={s.fieldEditorSheet}>
            <View style={s.sheetHandle} />

            {/* Header */}
            <View style={s.fieldEditorHeader}>
              <View style={s.modalTitleRow}>
                <LinearGradient colors={['#059669', '#10b981']} style={s.modalIconCircle}>
                  <DynamicIcon name="columns" size={14} color="#fff" />
                </LinearGradient>
                <View>
                  <Text style={s.modalTitle}>Edit Fields</Text>
                  <Text style={s.fieldEditorSub}>{fieldEditorTable?.name}</Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setShowFieldEditor(false)}>
                <IconClose size={20} color={colors.gray400} />
              </TouchableOpacity>
            </View>

            <ScrollView style={s.fieldEditorScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {/* Existing fields */}
              <Text style={s.sectionLabel}>CURRENT FIELDS ({fields.length}/30)</Text>
              {fields.length === 0 && (
                <View style={s.noFieldsEmpty}>
                  <Text style={s.noFieldsText}>No fields yet. Add your first field below.</Text>
                </View>
              )}
              {fields.map((f, i) => {
                const ft = FIELD_TYPES.find(x => x.key === f.type) || FIELD_TYPES[0];
                return (
                  <View key={i} style={s.fieldRow}>
                    <View style={[s.fieldTypeIcon, { backgroundColor: ft.color + '15' }]}>
                      <DynamicIcon name={ft.icon} size={11} color={ft.color} />
                    </View>
                    <View style={s.fieldRowInfo}>
                      <Text style={s.fieldRowName} numberOfLines={1}>{f.name}</Text>
                      <Text style={s.fieldRowType}>{ft.label}{f.mandatory ? ' · Required' : ''}</Text>
                    </View>
                    <View style={s.fieldRowActions}>
                      <TouchableOpacity onPress={() => toggleMandatory(i)} style={s.fieldRowBtn}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                        <View style={[s.mandatoryToggle, f.mandatory && s.mandatoryToggleOn]}>
                          <Text style={[s.mandatoryToggleText, f.mandatory && { color: '#fff' }]}>!</Text>
                        </View>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => moveFieldUp(i)} style={s.fieldRowBtn}
                        disabled={i === 0} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                        <DynamicIcon name="chevron-up" size={10} color={i === 0 ? colors.gray200 : colors.gray500} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => moveFieldDown(i)} style={s.fieldRowBtn}
                        disabled={i === fields.length - 1} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                        <DynamicIcon name="chevron-down" size={10} color={i === fields.length - 1 ? colors.gray200 : colors.gray500} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => removeField(i)} style={s.fieldRowBtn}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                        <DynamicIcon name="times" size={10} color="#ef4444" />
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}

              {/* Add new field */}
              {fields.length < 30 && (
                <View style={s.addFieldSection}>
                  <Text style={s.sectionLabel}>ADD NEW FIELD</Text>
                  <TextInput
                    style={[s.textInput, newFieldNameLocked && { backgroundColor: '#f1f5f9', color: colors.gray400 }]}
                    value={newFieldName}
                    onChangeText={setNewFieldName}
                    placeholder="Field name (e.g. ROLL NO)"
                    placeholderTextColor={colors.gray300}
                    editable={!newFieldNameLocked}
                  />
                  {newFieldNameLocked && (
                    <Text style={{ fontSize: 8, fontFamily: 'SairaSemiCondensed-Medium', color: colors.gray400, marginTop: 2, marginBottom: 4 }}>
                      Name auto-filled for this field type
                    </Text>
                  )}
                  <Text style={[s.sectionLabel, { marginTop: 12 }]}>FIELD TYPE</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.fieldTypesRow}>
                    {FIELD_TYPES.map(ft => (
                      <TouchableOpacity
                        key={ft.key}
                        style={[s.fieldTypeChip, newFieldType === ft.key && { borderColor: ft.color, backgroundColor: ft.color + '15' }]}
                        onPress={() => handleFieldTypeChange(ft.key)}
                        activeOpacity={0.7}
                      >
                        <DynamicIcon name={ft.icon} size={11} color={newFieldType === ft.key ? ft.color : colors.gray400} />
                        <Text style={[s.fieldTypeChipText, newFieldType === ft.key && { color: ft.color, fontFamily: 'SairaSemiCondensed-Bold' }]}>
                          {ft.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                  <TouchableOpacity
                    style={s.mandatoryRow}
                    onPress={() => setNewFieldMandatory(p => !p)}
                    activeOpacity={0.7}
                  >
                    <View style={[s.checkbox, newFieldMandatory && s.checkboxChecked]}>
                      {newFieldMandatory && <DynamicIcon name="check" size={8} color="#fff" />}
                    </View>
                    <Text style={s.mandatoryLabel}>Mark as required / mandatory</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.addFieldBtn} onPress={addField} activeOpacity={0.8}>
                    <LinearGradient colors={['#059669', '#10b981']} style={s.addFieldBtnInner}>
                      <IconPlus size={13} color="#fff" />
                      <Text style={s.addFieldBtnText}>ADD FIELD</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                </View>
              )}

              <View style={{ height: 20 }} />
            </ScrollView>

            {/* Save bar */}
            <View style={[s.fieldSaveBar, { paddingBottom: insets.bottom + 12 }]}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setShowFieldEditor(false)}>
                <Text style={s.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.saveBtn} onPress={saveFields} disabled={fieldsSaving}>
                <LinearGradient colors={gradients.brand} style={s.saveBtnInner}>
                  {fieldsSaving
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={s.saveText}>SAVE FIELDS</Text>}
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
      <Toast visible={toast.visible} message={toast.message} type={toast.type}
        onHide={() => setToast(p => ({ ...p, visible: false }))} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceBg },
  list: { paddingHorizontal: 12, paddingTop: 8 },

  // Search header
  searchSection: { paddingBottom: 12 },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: radius.xs, paddingHorizontal: 12, height: 44, borderWidth: 1, borderColor: colors.gray100, ...shadows.sm },
  searchInput: { flex: 1, marginLeft: 8, fontSize: 13, fontFamily: 'SairaSemiCondensed-Medium', color: colors.gray800 },

  // Group card
  groupCard: { backgroundColor: '#fff', borderRadius: radius.sm, marginBottom: 12, ...shadows.sm, borderWidth: 1, borderColor: '#e2e8f0', overflow: 'hidden' },
  groupHeader: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  groupIconCircle: { width: 38, height: 38, borderRadius: radius.xs, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  groupInfo: { flex: 1 },
  groupName: { fontSize: 14, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray800 },
  groupMeta: { fontSize: 10, fontFamily: 'SairaSemiCondensed-Medium', color: colors.gray400, marginTop: 2 },
  groupEditBtnText: { paddingVertical: 5, paddingHorizontal: 9, borderRadius: radius.xs, borderWidth: 1, borderColor: '#e2e8f0', backgroundColor: '#f8fafc', marginLeft: 6 },
  groupEditText: { fontSize: 9, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray600 },
  groupDeleteBtnText: { paddingVertical: 5, paddingHorizontal: 9, borderRadius: radius.xs, borderWidth: 1, borderColor: '#fee2e2', backgroundColor: '#fef2f2', marginLeft: 6 },
  groupDeleteText: { fontSize: 9, fontFamily: 'SairaSemiCondensed-Bold', color: '#ef4444' },
  groupBody: { borderTopWidth: 1, borderTopColor: '#f1f5f9', backgroundColor: '#fafbfc', paddingHorizontal: 12, paddingVertical: 10 },

  // Table card
  tableCard: { backgroundColor: '#fff', borderRadius: radius.xs, marginBottom: 8, borderWidth: 1, borderColor: '#f1f5f9', ...shadows.sm },
  tableHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10 },
  tableIconCircle: { width: 28, height: 28, borderRadius: 6, backgroundColor: '#f5f3ff', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  tableInfo: { flex: 1 },
  tableName: { fontSize: 12, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray800 },
  tableMeta: { fontSize: 9, fontFamily: 'SairaSemiCondensed-Medium', color: colors.gray400, marginTop: 1 },
  tableStatusRow: { flexDirection: 'row', gap: 3, marginRight: 6 },
  miniStatBadge: { paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4, minWidth: 20, alignItems: 'center' },
  miniStatText: { fontSize: 9, fontFamily: 'SairaSemiCondensed-Bold' },
  tableExpanded: { borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingHorizontal: 12, paddingBottom: 12 },
  tableActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingTop: 10, marginBottom: 10 },
  tableAction: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#f8fafc', paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.xs, borderWidth: 1, borderColor: '#e2e8f0' },
  tableActionText: { fontSize: 9, fontFamily: 'SairaSemiCondensed-Bold' },

  // Fields preview
  fieldsPreview: {},
  fieldsPreviewTitle: { fontSize: 8, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray400, marginBottom: 6, letterSpacing: 0.5 },
  fieldChipsRow: { flexDirection: 'row', gap: 6, paddingBottom: 4 },
  fieldChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: radius.xs, borderWidth: 1 },
  fieldChipText: { fontSize: 10, fontFamily: 'SairaSemiCondensed-Bold' },
  mandatoryDot: { width: 5, height: 5, borderRadius: 2.5 },
  noFieldsRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, backgroundColor: '#f8fafc', borderRadius: radius.xs },
  noFieldsText: { fontSize: 10, color: colors.gray400, fontFamily: 'SairaSemiCondensed-Medium', flex: 1 },
  noFieldsEmpty: { padding: 12, backgroundColor: '#f8fafc', borderRadius: radius.xs, marginBottom: 8 },

  // Add table btn
  addTableBtn: { marginTop: 6, borderRadius: radius.xs, overflow: 'hidden', height: 36 },
  addTableBtnInner: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  addTableBtnText: { fontSize: 10, fontFamily: 'SairaSemiCondensed-Bold', color: '#7c3aed' },

  // Empty
  emptyTables: { alignItems: 'center', paddingVertical: 16, gap: 6 },
  emptyTablesText: { fontSize: 11, color: colors.gray400, fontFamily: 'SairaSemiCondensed-Medium' },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyIcon: { width: 70, height: 70, borderRadius: radius.xl, backgroundColor: colors.gray100, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: 15, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray500 },
  emptySub: { fontSize: 11, fontFamily: 'SairaSemiCondensed-Medium', color: colors.gray400, marginTop: 4, marginBottom: 20 },
  emptyAddBtn: { borderRadius: radius.xs, overflow: 'hidden' },
  emptyAddBtnInner: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 20, paddingVertical: 12 },
  emptyAddBtnText: { fontSize: 12, fontFamily: 'SairaSemiCondensed-Bold', color: '#fff' },

  // Modal base
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalBg: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  modalSheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingTop: 12 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.gray200, alignSelf: 'center', marginBottom: 16 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  modalIconCircle: { width: 36, height: 36, borderRadius: radius.xs, alignItems: 'center', justifyContent: 'center' },
  modalTitle: { fontSize: 16, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray800 },
  inputLabel: { fontSize: 10, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray500, marginBottom: 6, letterSpacing: 0.5 },
  textInput: { backgroundColor: colors.gray50, borderRadius: radius.xs, paddingHorizontal: 14, height: 46, fontSize: 13, fontFamily: 'SairaSemiCondensed-Medium', color: colors.gray800, borderWidth: 1, borderColor: colors.gray100, marginBottom: 4 },
  modalFooter: { flexDirection: 'row', gap: 12, marginTop: 20 },
  cancelBtn: { flex: 1, height: 46, borderRadius: radius.xs, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.gray100 },
  cancelText: { fontSize: 13, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray600 },
  saveBtn: { flex: 2, height: 46, borderRadius: radius.xs, overflow: 'hidden' },
  saveBtnInner: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  saveText: { fontSize: 13, fontFamily: 'SairaSemiCondensed-Bold', color: '#fff' },

  // Field editor
  fieldEditorOverlay: { flex: 1, justifyContent: 'flex-end' },
  fieldEditorSheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '92%' },
  fieldEditorHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingBottom: 12 },
  fieldEditorSub: { fontSize: 10, color: colors.gray400, fontFamily: 'SairaSemiCondensed-Medium', marginTop: 2 },
  fieldEditorScroll: { paddingHorizontal: 20 },
  sectionLabel: { fontSize: 9, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray400, marginBottom: 10, letterSpacing: 0.5 },

  // Field rows
  fieldRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  fieldTypeIcon: { width: 28, height: 28, borderRadius: 6, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  fieldRowInfo: { flex: 1 },
  fieldRowName: { fontSize: 12, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray800 },
  fieldRowType: { fontSize: 9, color: colors.gray400, fontFamily: 'SairaSemiCondensed-Medium', marginTop: 1 },
  fieldRowActions: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  fieldRowBtn: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  mandatoryToggle: { width: 20, height: 20, borderRadius: 4, borderWidth: 1.5, borderColor: colors.gray300, alignItems: 'center', justifyContent: 'center' },
  mandatoryToggleOn: { backgroundColor: '#ef4444', borderColor: '#ef4444' },
  mandatoryToggleText: { fontSize: 11, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray400 },

  // Add field section
  addFieldSection: { marginTop: 20 },
  fieldTypesRow: { flexDirection: 'row', gap: 8, paddingVertical: 4 },
  fieldTypeChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: radius.xs, borderWidth: 1, borderColor: colors.gray200, backgroundColor: '#f8fafc' },
  fieldTypeChipText: { fontSize: 10, fontFamily: 'SairaSemiCondensed-Medium', color: colors.gray500 },
  mandatoryRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, marginBottom: 12 },
  checkbox: { width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, borderColor: colors.gray300, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  mandatoryLabel: { fontSize: 12, fontFamily: 'SairaSemiCondensed-Medium', color: colors.gray600 },
  addFieldBtn: { borderRadius: radius.xs, overflow: 'hidden', marginTop: 4 },
  addFieldBtnInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12 },
  addFieldBtnText: { fontSize: 12, fontFamily: 'SairaSemiCondensed-Bold', color: '#fff' },

  // Field save bar
  fieldSaveBar: { flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingTop: 14, borderTopWidth: 1, borderTopColor: '#f1f5f9', backgroundColor: '#fff' },
});
