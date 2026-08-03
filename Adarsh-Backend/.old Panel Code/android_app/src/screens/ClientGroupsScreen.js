import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, TextInput, Modal, ActivityIndicator,
  ScrollView, Alert, Linking, Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import { DynamicIcon, IconPlus, IconClose, IconEdit, IconTrash } from '../components/Icons';
import TopBar from '../components/TopBar';
import Toast from '../components/Toast';
import ConfirmModal from '../components/ConfirmModal';
import { ClientGroupsSkeleton } from '../components/Skeleton';
import { ErrorBanner } from '../components/NetworkGuard';
import { apiGet, apiPost, apiPostForm, BASE_URL } from '../api/client';
import { colors, shadows, radius, roleThemes, gradients } from '../theme';
import { useAuth } from '../context/AuthContext';
import useRefreshableResource from '../hooks/useRefreshableResource';

const { width, height } = Dimensions.get('window');

const STATUS_OPTIONS = [
  { key: 'all',      label: 'ALL',       color: colors.brandPrimary, icon: 'list' },
  { key: 'pending',  label: 'PENDING',   color: '#f59e0b',           icon: 'clock' },
  { key: 'verified', label: 'VERIFIED',  color: '#10b981',           icon: 'check-circle' },
  { key: 'approved', label: 'APPROVED',  color: '#3b82f6',           icon: 'thumbs-up' },
  { key: 'download', label: 'DOWNLOAD',  color: '#8b5cf6',           icon: 'download' },
  { key: 'pool',     label: 'POOL',      color: '#ec4899',           icon: 'layer-group' },
];

const STATUS_COLORS = {
  pending:  { bg: '#fffbeb', text: '#f59e0b', border: '#fef3c7', icon: 'clock' },
  verified: { bg: '#ecfdf5', text: '#10b981', border: '#d1fae5', icon: 'check-circle' },
  approved: { bg: '#eff6ff', text: '#3b82f6', border: '#dbeafe', icon: 'thumbs-up' },
  download: { bg: '#f5f3ff', text: '#8b5cf6', border: '#e0e7ff', icon: 'download' },
  pool:     { bg: '#fef2f2', text: '#ef4444', border: '#fee2fee', icon: 'layer-group' },
};

export default function ClientGroupsScreen({ navigation, route }) {
  const clientId = route?.params?.clientId;
  const clientName = route?.params?.clientName || 'Client';
  const initialStatus = route?.params?.initialStatus || 'all';
  const [currentStatus, setCurrentStatus] = useState(initialStatus);

  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const theme = roleThemes[user?.role] || roleThemes.default;

  // Permissions matching web
  const isSuperAdmin = user?.role === 'super_admin' || user?.isSuperAdmin;
  const isClientRole = user?.role === 'client' || user?.role === 'client_staff' || user?.role === 'guest_user';
  const perms = user?.permissions || {};

  const canDownloadAll = !isClientRole && (isSuperAdmin || perms.perm_idcard_bulk_download);
  const canReupload = isSuperAdmin || perms.perm_idcard_bulk_reupload;
  const canDeleteAll = isSuperAdmin || perms.perm_delete_all_idcard;
  const canUpgradeAll = isSuperAdmin || perms.perm_idcard_upgrade_all;

  // ── States ───────────────────────────────────────────────────────────────
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });
  const [confirmModal, setConfirmModal] = useState({ visible: false, title: '', message: '', icon: '', color: colors.brandPrimary, onConfirm: null });

  // Bulk action states
  const [selectedTable, setSelectedTable] = useState(null);
  const [showActionsModal, setShowActionsModal] = useState(false);

  // Security code inputs
  const [showCodeModal, setShowCodeModal] = useState(false);
  const [codeAction, setCodeAction] = useState(''); // 'delete_all' | 'upgrade_class'
  const [expectedCode, setExpectedCode] = useState('');
  const [enteredCode, setEnteredCode] = useState('');
  const [totalCardsInModal, setTotalCardsInModal] = useState(0);
  const [codeConfirming, setCodeConfirming] = useState(false);

  // Upload/Reupload task states
  const [showProgressModal, setShowProgressModal] = useState(false);
  const [reuploading, setReuploading] = useState(false);
  const [reuploadProgress, setReuploadProgress] = useState(0);
  const [reuploadStatus, setReuploadStatus] = useState('');
  const [reuploadTaskId, setReuploadTaskId] = useState('');

  const showToast = useCallback((msg, type = 'info') => setToast({ visible: true, message: msg, type }), []);

  // ── Load Data ─────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      // Use the existing client groups API which returns groups populated with tables & counts
      const { ok, data } = await apiGet(`/api/mobile/client/${clientId}/groups/`);
      if (ok && data?.success) {
        return data.groups || [];
      } else {
        throw new Error(data?.message || 'Failed to load client groups');
      }
    } catch (e) {
      throw new Error(e.message || 'Network error - check your connection');
    }
  }, [clientId]);

  const { data: groups = [], loading, refreshing, error, refresh } = useRefreshableResource(loadData, { initialData: [] });

  // Extract flat list of tables for filtering
  const allTables = useMemo(() => {
    const list = [];
    groups.forEach(g => {
      if (g.tables && g.tables.length > 0) {
        g.tables.forEach(t => {
          list.push({ ...t, group_name: g.name });
        });
      }
    });
    return list;
  }, [groups]);

  // Aggregated status counts across all client tables to display in the tabs
  const statusCounts = useMemo(() => {
    const counts = { all: 0, pending: 0, verified: 0, approved: 0, download: 0, pool: 0 };
    allTables.forEach(t => {
      counts.pending += (t.pending_count || 0);
      counts.verified += (t.verified_count || 0);
      counts.approved += (t.approved_count || 0);
      counts.download += (t.download_count || 0);
      counts.pool += (t.pool_count || 0);
    });
    counts.all = counts.pending + counts.verified + counts.approved + counts.download + counts.pool;
    return counts;
  }, [allTables]);

  const filteredTables = useMemo(() => {
    if (currentStatus === 'all') return allTables;
    return allTables.filter(t => (t[`${currentStatus}_count`] || 0) > 0);
  }, [allTables, currentStatus]);

  // ── Actions ──────────────────────────────────────────────────────────────
  const handleOpenActions = (table) => {
    setSelectedTable(table);
    setShowActionsModal(true);
  };

  const handleDownloadAllRequest = (table) => {
    setShowActionsModal(false);
    setConfirmModal({
      visible: true,
      title: 'Download ZIP?',
      message: `Are you sure you want to export and download all ID cards for "${table.name}"? This contains all approved/downloaded cards.`,
      icon: 'download',
      color: '#3b82f6',
      onConfirm: () => {
        setConfirmModal(p => ({ ...p, visible: false }));
        handleDownloadAll();
      }
    });
  };

  const handleReuploadZIPRequest = (table) => {
    setShowActionsModal(false);
    setConfirmModal({
      visible: true,
      title: 'Reupload Photos?',
      message: `Select a ZIP archive containing student photos for "${table.name}". Photos must match Student IDs. Proceed to select a file?`,
      icon: 'upload',
      color: '#10b981',
      onConfirm: () => {
        setConfirmModal(p => ({ ...p, visible: false }));
        handleReuploadZIP();
      }
    });
  };

  // 1. Download ZIP
  const handleDownloadAll = async () => {
    if (!selectedTable) return;
    const table = selectedTable;
    setShowActionsModal(false);
    showToast('Preparing ZIP download...', 'info');
    try {
      const { ok, data } = await apiPost(`/api/table/${table.id}/cards/download-all/`, {});
      if (ok && data?.success) {
        if (data.download_url) {
          const fullUrl = data.download_url.startsWith('http') ? data.download_url : `${BASE_URL}${data.download_url}`;
          Linking.openURL(fullUrl);
          showToast('ZIP download started!', 'success');
        } else {
          showToast(data.message || 'No files to download', 'warning');
        }
      } else {
        showToast(data?.message || 'Download failed', 'error');
      }
    } catch (e) {
      showToast('Network error preparing ZIP', 'error');
    }
  };

  // 2. Delete All ID Cards
  const requestDeleteAll = async () => {
    if (!selectedTable) return;
    const table = selectedTable;
    setShowActionsModal(false);
    showToast('Requesting delete code...', 'info');
    try {
      const { ok, data } = await apiPost(`/api/table/${table.id}/cards/generate-delete-code/`, {});
      if (ok && data?.success) {
        setExpectedCode(data.code);
        setEnteredCode('');
        setCodeAction('delete_all');
        setCodeTable(table);
        setTotalCardsInModal(data.total_cards);
        setShowCodeModal(true);
        setToast({ visible: false, message: '', type: 'info' });
      } else {
        showToast(data?.message || 'Failed to generate code', 'error');
      }
    } catch (e) {
      showToast('Network error generating confirmation code', 'error');
    }
  };

  const handleConfirmDeleteAll = async () => {
    if (enteredCode !== expectedCode) {
      showToast('Confirmation code mismatch', 'error');
      return;
    }
    setCodeConfirming(true);
    try {
      const { ok, data } = await apiPost(`/api/table/${selectedTable.id}/cards/bulk-delete/`, {
        delete_all: true,
        confirmation_code: enteredCode.trim(),
      });
      if (ok && data?.success) {
        showToast('All cards deleted successfully!', 'success');
        setShowCodeModal(false);
        refresh();
      } else {
        showToast(data?.message || 'Delete failed', 'error');
      }
    } catch (e) {
      showToast('Network error deleting records', 'error');
    }
    setCodeConfirming(false);
  };

  // 3. Upgrade All Classes
  const requestUpgradeAll = async () => {
    if (!selectedTable) return;
    const table = selectedTable;
    setShowActionsModal(false);
    showToast('Requesting upgrade code...', 'info');
    try {
      const { ok, data } = await apiPost(`/api/table/${table.id}/cards/generate-upgrade-code/`, {});
      if (ok && data?.success) {
        setExpectedCode(data.code);
        setEnteredCode('');
        setCodeAction('upgrade_class');
        setCodeTable(table);
        setTotalCardsInModal(data.download_count);
        setShowCodeModal(true);
        setToast({ visible: false, message: '', type: 'info' });
      } else {
        showToast(data?.message || 'Failed to generate code', 'error');
      }
    } catch (e) {
      showToast('Network error generating confirmation code', 'error');
    }
  };

  const handleConfirmUpgradeAll = async () => {
    if (enteredCode !== expectedCode) {
      showToast('Confirmation code mismatch', 'error');
      return;
    }
    setCodeConfirming(true);
    try {
      const { ok, data } = await apiPost(`/api/table/${selectedTable.id}/cards/upgrade-classes/`, {
        confirmation_code: enteredCode.trim(),
      });
      if (ok && data?.success) {
        showToast('All classes upgraded successfully!', 'success');
        setShowCodeModal(false);
        refresh();
      } else {
        showToast(data?.message || 'Class upgrade failed', 'error');
      }
    } catch (e) {
      showToast('Network error upgrading classes', 'error');
    }
    setCodeConfirming(false);
  };

  // Helper references for security codes
  const [codeTable, setCodeTable] = useState(null);

  // 4. Reupload ZIP images task
  const handleReuploadZIP = async () => {
    if (!selectedTable) return;
    const table = selectedTable;
    setShowActionsModal(false);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/zip',
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const file = result.assets[0];
      if (!file.name.toLowerCase().endsWith('.zip')) {
        showToast('Only ZIP archives are allowed', 'warning');
        return;
      }

      setReuploading(true);
      setReuploadProgress(0);
      setReuploadStatus('Uploading ZIP archive...');
      setShowProgressModal(true);

      const formData = new FormData();
      formData.append('photos_zip', {
        uri: file.uri,
        name: file.name,
        type: 'application/zip',
      });

      const { ok, data } = await apiPostForm(`/api/table/${table.id}/reupload-task/`, formData);
      if (ok && data?.success && data.task_id) {
        setReuploadTaskId(data.task_id);
        pollTaskStatus(data.task_id);
      } else {
        showToast(data?.message || 'ZIP upload failed to start', 'error');
        setReuploading(false);
        setShowProgressModal(false);
      }
    } catch (e) {
      showToast('Error uploading ZIP archive', 'error');
      setReuploading(false);
      setShowProgressModal(false);
    }
  };

  const pollTaskStatus = (taskId) => {
    const pollInterval = setInterval(async () => {
      try {
        const { ok, data } = await apiGet(`/api/task-status/${taskId}/`);
        if (ok) {
          if (data.status === 'completed') {
            clearInterval(pollInterval);
            setReuploadProgress(100);
            const matched = (data.result && data.result.matched_count != null) ? data.result.matched_count : '';
            const msg = matched !== '' ? `Matched ${matched} images successfully!` : 'ZIP processed successfully!';
            setReuploadStatus(msg);
            showToast(msg, 'success');
            setTimeout(() => {
              setShowProgressModal(false);
              setReuploading(false);
              refresh();
            }, 1800);
          } else if (data.status === 'failed' || data.status === 'cancelled') {
            clearInterval(pollInterval);
            const errMsg = data.error_message || 'Task failed or cancelled.';
            setReuploadStatus(errMsg);
            showToast(errMsg, 'error');
            setTimeout(() => {
              setShowProgressModal(false);
              setReuploading(false);
            }, 2500);
          } else {
            const pct = 80 + Math.round((data.progress_percentage || 0) * 0.19);
            setReuploadProgress(Math.min(pct, 99));
            setReuploadStatus(`Matching images: ${data.progress || 0}/${data.total || '?'}...`);
          }
        }
      } catch (err) {
        // network warning but keep polling
      }
    }, 2000);
  };

  const handleCancelReupload = async () => {
    if (reuploadTaskId) {
      try { await apiPost(`/api/task-cancel/${reuploadTaskId}/`, {}); } catch (e) {}
      showToast('ZIP matching cancelled', 'info');
    }
    setShowProgressModal(false);
    setReuploading(false);
  };

  // ── Render Items ─────────────────────────────────────────────────────────
  const renderTableItem = useCallback(({ item: table }) => {
    return (
      <TableCardRow
        table={table}
        navigation={navigation}
        onOpenActions={handleOpenActions}
        currentStatus={currentStatus}
      />
    );
  }, [handleOpenActions, navigation, currentStatus]);

  return (
    <View style={s.root}>
      <TopBar title={clientName} subtitle="ID Card Tables" onBack={() => navigation.goBack()} />

      {/* Status tabs */}
      <View style={s.tabContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabScroll}>
          {STATUS_OPTIONS.map(opt => {
            const isActive = currentStatus === opt.key;
            return (
              <TouchableOpacity
                key={opt.key}
                onPress={() => setCurrentStatus(opt.key)}
                style={[
                  s.tabItem,
                  isActive && { backgroundColor: opt.color, borderColor: opt.color }
                ]}
              >
                <Text style={[s.tabLabel, { color: isActive ? '#fff' : opt.color }]}>
                  {opt.label}
                </Text>
                <View 
                  style={[
                    s.tabCount, 
                    { backgroundColor: isActive ? 'rgba(255,255,255,0.2)' : `${opt.color}15` }
                  ]}
                >
                  <Text style={[s.tabCountText, { color: isActive ? '#fff' : opt.color }]}>
                    {statusCounts[opt.key] || 0}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {error && <ErrorBanner message={error} onDismiss={() => {}} onRetry={refresh} />}

      {loading ? (
        <ClientGroupsSkeleton />
      ) : (
        <FlatList
          data={filteredTables}
          renderItem={renderTableItem}
          keyExtractor={item => item.id.toString()}
          contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.primary} />}
          ListEmptyComponent={
            <View style={s.empty}>
              <View style={s.emptyIcon}><DynamicIcon name="table" size={24} color={colors.gray300} /></View>
              <Text style={s.emptyTitle}>No tables found</Text>
              <Text style={s.emptySub}>This client has no ID card tables yet.</Text>
            </View>
          }
        />
      )}

      {/* ── Bulk Actions Modal Sheet ────────────────────────────────────────── */}
      <Modal visible={showActionsModal} animationType="slide" transparent onRequestClose={() => setShowActionsModal(false)}>
        <View style={s.modalOverlay}>
          <TouchableOpacity style={s.modalBg} activeOpacity={1} onPress={() => setShowActionsModal(false)} />
          <View style={s.modalSheet}>
            <View style={s.sheetHandle} />
            <View style={s.modalHeader}>
              <View style={s.modalTitleRow}>
                <LinearGradient colors={['#7c3aed', '#4f46e5']} style={s.modalIconCircle}>
                  <DynamicIcon name="table" size={14} color="#fff" />
                </LinearGradient>
                <View>
                  <Text style={s.modalTitle}>{selectedTable?.name}</Text>
                  <Text style={s.modalSub}>Bulk Actions</Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setShowActionsModal(false)}>
                <IconClose size={20} color={colors.gray400} />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={s.actionsList}>
              {/* Action: Download ZIP */}
              <TouchableOpacity
                style={[s.actionRow, !canDownloadAll && s.actionRowDisabled]}
                onPress={() => handleDownloadAllRequest(selectedTable)}
                disabled={!canDownloadAll}
              >
                <View style={[s.actionIconBox, { backgroundColor: '#eff6ff' }]}>
                  <DynamicIcon name="download" size={14} color="#3b82f6" />
                </View>
                <View style={s.actionInfo}>
                  <Text style={s.actionLabel}>Download All ID Cards</Text>
                  <Text style={s.actionDescription}>Export all approved/downloaded cards as ZIP</Text>
                </View>
              </TouchableOpacity>

              {/* Action: Reupload ZIP */}
              <TouchableOpacity
                style={[s.actionRow, !canReupload && s.actionRowDisabled]}
                onPress={() => handleReuploadZIPRequest(selectedTable)}
                disabled={!canReupload}
              >
                <View style={[s.actionIconBox, { backgroundColor: '#ecfdf5' }]}>
                  <DynamicIcon name="upload" size={14} color="#10b981" />
                </View>
                <View style={s.actionInfo}>
                  <Text style={s.actionLabel}>Reupload Image ZIP</Text>
                  <Text style={s.actionDescription}>Upload and match student photos ZIP</Text>
                </View>
              </TouchableOpacity>

              {/* Action: Upgrade Classes */}
              {(() => {
                const hasClass = selectedTable?.fields && selectedTable.fields.some(f => f.type === 'class' || f.type === 'class_section');
                const allowed = canUpgradeAll && hasClass;
                return (
                  <TouchableOpacity
                    style={[s.actionRow, !allowed && s.actionRowDisabled]}
                    onPress={requestUpgradeAll}
                    disabled={!allowed}
                  >
                    <View style={[s.actionIconBox, { backgroundColor: '#fffbeb' }]}>
                      <DynamicIcon name="arrow-up" size={14} color="#f59e0b" />
                    </View>
                    <View style={s.actionInfo}>
                      <Text style={s.actionLabel}>Upgrade All Classes</Text>
                      <Text style={s.actionDescription}>
                        {!hasClass ? 'No class field in table' : 'Clear or promote class batch details'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })()}

              {/* Action: Delete All */}
              <TouchableOpacity
                style={[s.actionRow, !canDeleteAll && s.actionRowDisabled]}
                onPress={requestDeleteAll}
                disabled={!canDeleteAll}
              >
                <View style={[s.actionIconBox, { backgroundColor: '#fef2f2' }]}>
                  <DynamicIcon name="trash" size={14} color="#ef4444" />
                </View>
                <View style={s.actionInfo}>
                  <Text style={[s.actionLabel, { color: '#ef4444' }]}>Delete All ID Cards</Text>
                  <Text style={s.actionDescription}>Securely wipe all records in this table</Text>
                </View>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── 10-Digit Code Confirmation Modal ────────────────────────────────── */}
      <Modal visible={showCodeModal} animationType="fade" transparent onRequestClose={() => setShowCodeModal(false)}>
        <View style={s.codeModalOverlay}>
          <TouchableOpacity style={s.modalBg} activeOpacity={1} onPress={() => setShowCodeModal(false)} />
          <View style={s.codeModalSheet}>
            <Text style={s.codeModalTitle}>
              {codeAction === 'delete_all' ? 'Delete All Records?' : 'Upgrade Table Classes?'}
            </Text>
            <Text style={s.codeModalDesc}>
              {codeAction === 'delete_all'
                ? `You are about to delete all ${totalCardsInModal} cards in "${selectedTable?.name}". This is permanent.`
                : `You are about to promote/upgrade classes for ${totalCardsInModal} downloaded cards in "${selectedTable?.name}".`}
            </Text>

            <View style={s.expectedCodeBox}>
              <Text style={s.expectedCodeLabel}>ENTER THE CONFIRMATION CODE:</Text>
              <Text style={s.expectedCode}>{expectedCode}</Text>
            </View>

            <TextInput
              style={s.codeInput}
              value={enteredCode}
              onChangeText={setEnteredCode}
              placeholder="Type confirmation code here"
              placeholderTextColor={colors.gray300}
              keyboardType="number-pad"
              maxLength={10}
              autoFocus
            />

            <View style={s.codeModalFooter}>
              <TouchableOpacity style={s.cancelCodeBtn} onPress={() => setShowCodeModal(false)}>
                <Text style={s.cancelCodeText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.confirmCodeBtn, enteredCode !== expectedCode && s.confirmCodeBtnDisabled]}
                onPress={codeAction === 'delete_all' ? handleConfirmDeleteAll : handleConfirmUpgradeAll}
                disabled={enteredCode !== expectedCode || codeConfirming}
              >
                {codeConfirming ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={s.confirmCodeText}>CONFIRM</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── ZIP Upload Progress Modal ───────────────────────────────────────── */}
      <Modal visible={showProgressModal} animationType="fade" transparent>
        <View style={s.progressOverlay}>
          <View style={s.progressCard}>
            <Text style={s.progressTitle}>Uploading Images ZIP</Text>
            <Text style={s.progressSubtitle}>{selectedTable?.name}</Text>

            <View style={s.progressBarBackground}>
              <View style={[s.progressBarFill, { width: `${reuploadProgress}%` }]} />
            </View>

            <Text style={s.progressStatus}>{reuploadStatus}</Text>
            <Text style={s.progressPercent}>{reuploadProgress}%</Text>

            <TouchableOpacity style={s.cancelUploadBtn} onPress={handleCancelReupload}>
              <Text style={s.cancelUploadText}>CANCEL TASK</Text>
            </TouchableOpacity>
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

const MiniCount = React.memo(function MiniCount({ count, bg, c }) {
  return (<View style={[s.miniCount, { backgroundColor: bg }]}><Text style={[s.miniCountText, { color: c }]}>{count}</Text></View>);
});

const TableBadgeButton = React.memo(({ opt, table, navigation }) => {
  const sc = STATUS_COLORS[opt.key];
  const count = table[`${opt.key}_count`] || 0;
  const onPress = useCallback(() => {
    navigation.navigate('CardList', { tableId: table.id, status: opt.key });
  }, [navigation, table.id, opt.key]);

  return (
    <TouchableOpacity
      style={[s.badgeButton, { borderColor: sc.border, backgroundColor: sc.bg }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <DynamicIcon name={sc.icon} size={10} color={sc.color} />
      <Text style={[s.badgeText, { color: sc.text }]}>{opt.label}</Text>
      <View style={[s.badgeCountCircle, { backgroundColor: sc.text }]}>
        <Text style={s.badgeCountText}>{count}</Text>
      </View>
    </TouchableOpacity>
  );
});

const TableCardRow = React.memo(({ table, navigation, onOpenActions, currentStatus }) => {
  const totalCount = (table.pending_count || 0) + (table.verified_count || 0) +
                     (table.approved_count || 0) + (table.download_count || 0) +
                     (table.pool_count || 0);

  const handlePressInfo = useCallback(() => {
    const navStatus = currentStatus === 'all' ? 'pending' : currentStatus;
    navigation.navigate('CardList', { tableId: table.id, status: navStatus });
  }, [navigation, table.id, currentStatus]);

  const handlePressCog = useCallback(() => onOpenActions(table), [table, onOpenActions]);

  return (
    <View style={s.tableCard}>
      <View style={s.tableHeaderRow}>
        <TouchableOpacity
          style={s.tableInfoCol}
          onPress={handlePressInfo}
          activeOpacity={0.7}
        >
          <View style={s.tableIcon}><DynamicIcon name="table" size={12} color="#7c3aed" /></View>
          <View style={{ flex: 1 }}>
            <Text style={s.tableName} numberOfLines={1}>{table.name}</Text>
            <Text style={s.tableMeta}>
              {table.group_name ? `${table.group_name} · ` : ''}{totalCount} total cards · Tap cog for bulk actions
            </Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={s.cogButton}
          onPress={handlePressCog}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <DynamicIcon name="cog" size={14} color={colors.gray400} />
        </TouchableOpacity>
      </View>

      {/* Clickable Status Badges matching web style */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tableBadgesRow}>
        {STATUS_OPTIONS.slice(1).map(opt => (
          <TableBadgeButton
            key={opt.key}
            opt={opt}
            table={table}
            navigation={navigation}
          />
        ))}
      </ScrollView>
    </View>
  );
});

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceBg },
  tabContainer:        { backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  tabScroll:           { paddingHorizontal: 12, paddingVertical: 8 },
  tabItem:             { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.xs, borderWidth: 1, borderColor: '#f1f5f9', backgroundColor: '#f8fafc', marginRight: 8 },
  tabLabel:            { fontSize: 9, fontFamily: 'SairaSemiCondensed-Bold', marginRight: 6 },
  tabCount:            { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 10 },
  tabCountText:        { fontSize: 10, fontFamily: 'SairaSemiCondensed-Bold' },
  list: { padding: 12 },


  // Table card item
  tableCard: { backgroundColor: '#fff', borderRadius: radius.sm, padding: 14, borderWidth: 1, borderColor: colors.gray100, ...shadows.sm, marginBottom: 10 },
  tableHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  tableInfoCol: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  tableIcon: { width: 24, height: 24, borderRadius: 5, backgroundColor: '#f5f3ff', alignItems: 'center', justifyContent: 'center' },
  tableName: { fontSize: 12, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray800 },
  tableMeta: { fontSize: 9, color: colors.gray400, marginTop: 1 },
  cogButton: { padding: 6 },

  // Status badges row inside table row
  tableBadgesRow: { gap: 6, paddingVertical: 2 },
  badgeButton: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: radius.xs, borderWidth: 1 },
  badgeText: { fontSize: 9, fontFamily: 'SairaSemiCondensed-Bold' },
  badgeCountCircle: { width: 14, height: 14, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  badgeCountText: { fontSize: 8, fontFamily: 'SairaSemiCondensed-Bold', color: '#fff' },

  // Empty states
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.gray100, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: 13, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray400 },
  emptySub: { fontSize: 11, color: colors.gray300, marginTop: 4 },

  // Bottom Sheet Modal
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalBg: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  modalSheet: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, paddingTop: 10, maxHeight: height * 0.8 },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.gray200, alignSelf: 'center', marginBottom: 12 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  modalTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modalIconCircle: { width: 32, height: 32, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  modalTitle: { fontSize: 14, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray800 },
  modalSub: { fontSize: 10, color: colors.gray400, marginTop: 1 },

  // Actions list inside bottom sheet
  actionsList: { gap: 8, paddingBottom: 20 },
  actionRow: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: radius.sm, borderWidth: 1, borderColor: '#f1f5f9', backgroundColor: '#fdfdfd' },
  actionRowDisabled: { opacity: 0.4 },
  actionIconBox: { width: 32, height: 32, borderRadius: radius.xs, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  actionInfo: { flex: 1 },
  actionLabel: { fontSize: 12, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray800 },
  actionDescription: { fontSize: 9, color: colors.gray450, marginTop: 2 },

  // Security confirmation code modal
  codeModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  codeModalSheet: { backgroundColor: '#fff', borderRadius: radius.md, padding: 20, width: '100%', maxWidth: 360, ...shadows.md },
  codeModalTitle: { fontSize: 15, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray800, marginBottom: 8 },
  codeModalDesc: { fontSize: 11, color: colors.gray500, lineHeight: 15, marginBottom: 16 },
  expectedCodeBox: { backgroundColor: colors.gray50, padding: 12, borderRadius: radius.xs, borderWidth: 1, borderColor: colors.gray100, alignItems: 'center', marginBottom: 12 },
  expectedCodeLabel: { fontSize: 9, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray400, letterSpacing: 0.5 },
  expectedCode: { fontSize: 22, fontFamily: 'SairaSemiCondensed-Bold', color: colors.brandPrimary, marginTop: 4, letterSpacing: 3 },
  codeInput: { backgroundColor: colors.gray50, borderRadius: radius.xs, height: 44, fontSize: 14, fontFamily: 'SairaSemiCondensed-Medium', color: colors.gray800, borderWidth: 1, borderColor: colors.gray100, textAlign: 'center', letterSpacing: 1.5, marginBottom: 16 },
  codeModalFooter: { flexDirection: 'row', gap: 10 },
  cancelCodeBtn: { flex: 1, height: 44, borderRadius: radius.xs, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.gray100 },
  cancelCodeText: { fontSize: 12, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray600 },
  confirmCodeBtn: { flex: 2, height: 44, borderRadius: radius.xs, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brandPrimary },
  confirmCodeBtnDisabled: { backgroundColor: colors.gray300 },
  confirmCodeText: { fontSize: 12, fontFamily: 'SairaSemiCondensed-Bold', color: '#fff' },

  // ZIP Progress Modal
  progressOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  progressCard: { backgroundColor: '#fff', borderRadius: radius.md, padding: 24, width: '100%', maxWidth: 380, alignItems: 'center', ...shadows.lg },
  progressTitle: { fontSize: 15, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray800 },
  progressSubtitle: { fontSize: 11, color: colors.gray400, marginTop: 2, marginBottom: 20 },
  progressBarBackground: { width: '100%', height: 8, backgroundColor: '#f1f5f9', borderRadius: 4, overflow: 'hidden', marginBottom: 12 },
  progressBarFill: { height: '100%', backgroundColor: '#10b981' },
  progressStatus: { fontSize: 11, fontFamily: 'SairaSemiCondensed-Medium', color: colors.gray650, textAlign: 'center' },
  progressPercent: { fontSize: 24, fontFamily: 'SairaSemiCondensed-Bold', color: '#10b981', marginTop: 10, marginBottom: 20 },
  cancelUploadBtn: { width: '100%', height: 44, borderRadius: radius.xs, borderWidth: 1.5, borderColor: '#ef4444', alignItems: 'center', justifyContent: 'center' },
  cancelUploadText: { fontSize: 11, fontFamily: 'SairaSemiCondensed-Bold', color: '#ef4444' },
});
