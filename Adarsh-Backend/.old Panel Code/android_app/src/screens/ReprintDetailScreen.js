import React, { useState, useEffect, useCallback } from 'react';
import { 
  View, Text, FlatList, TouchableOpacity, Image, StyleSheet, 
  ActivityIndicator, RefreshControl, Alert, TextInput, Dimensions,
  Modal, TouchableWithoutFeedback
} from 'react-native';
import { DynamicIcon } from '../components/Icons';
import { LinearGradient } from 'expo-linear-gradient';
import TopBar from '../components/TopBar';
import Toast from '../components/Toast';
import StatusBadge from '../components/StatusBadge';
import { CardListSkeleton } from '../components/Skeleton';
import { ErrorBanner } from '../components/NetworkGuard';
import { apiGet, apiPost, getSessionCookies, resolveAdarshImageUrl } from '../api/client';
import { colors, gradients, shadows, radius, fontFamily, roleThemes } from '../theme';
import { useAuth } from '../context/AuthContext';
import CardModalForm from '../components/CardModalForm';

const { width } = Dimensions.get('window');

export default function ReprintDetailScreen({ navigation, route }) {
  const tableId = route?.params?.tableId;
  const { user } = useAuth();
  const theme = roleThemes[user?.role] || roleThemes.default;

  const perms = user?.permissions || {};
  const isSuperAdmin = user?.role === 'admin' || user?.isSuperAdmin;
  const isOperator = user?.role === 'admin_staff';
  const isAdminOrOperator = isSuperAdmin || isOperator;

  // Permissions gate check
  const isClient = user?.role === 'client' || user?.role === 'client_staff' || user?.role === 'guest_user';
  const isAssistant = user?.role === 'client_staff' || user?.role === 'guest_user';
  const hasDownloadTab = perms.perm_idcard_reprint_list || isAdminOrOperator || isClient || isAssistant;
  const hasRequestTab = perms.perm_reprint_request_list || isAdminOrOperator || isClient || isAssistant;
  const hasConfirmedTab = perms.perm_confirmed_list || isAdminOrOperator || isClient || isAssistant;

  // Tab State
  const [activeTab, setActiveTab] = useState(() => {
    if (hasDownloadTab) return 'download_list';
    if (hasRequestTab) return 'request_list';
    return 'confirmed';
  });

  const [cards, setCards] = useState([]);
  const [counts, setCounts] = useState({ download_list: 0, request_list: 0, confirmed: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [tableName, setTableName] = useState('');
  const [updating, setUpdating] = useState(null); // rr_id or card_id being updated
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });
  const [showEditForm, setShowEditForm] = useState(false);
  const [editingCardId, setEditingCardId] = useState(null);
  const [reprintConfirmModal, setReprintConfirmModal] = useState({ visible: false, cardId: null, name: '' });

  const canRequestReprint = perms.perm_idcard_reprint_list || isAdminOrOperator;
  
  // Search
  const [searchText, setSearchText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const perPage = 50;
  const showToast = (msg, type = 'info') => setToast({ visible: true, message: msg, type });

  // ── Debounce Search Query ───────────────────────────────────────────────
  useEffect(() => {
    const delayDebounce = setTimeout(() => {
      setSearchQuery(searchText);
    }, 400);
    return () => clearTimeout(delayDebounce);
  }, [searchText]);

  // ── Fetch Table Metadata ────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const { ok, data } = await apiGet(`/api/mobile/table/${tableId}/cards/`, { per_page: 1 });
        if (ok && data?.success) {
          setTableName(data.data?.table?.name || '');
        }
      } catch (e) {
        console.log('Failed to fetch table details', e);
      }
    })();
  }, [tableId]);

  // ── Fetch Data ──────────────────────────────────────────────────────────
  const loadCards = useCallback(async (pageNum = 1, append = false) => {
    try {
      setError(null);
      let endpoint = '';
      const offset = (pageNum - 1) * perPage;
      const limit = perPage;

      if (activeTab === 'download_list') {
        endpoint = `/reprint/api/table/${tableId}/reprint-list/?q=${searchQuery}&offset=${offset}&limit=${limit}`;
      } else if (activeTab === 'request_list') {
        endpoint = `/reprint/api/table/${tableId}/request-list/?q=${searchQuery}&offset=${offset}&limit=${limit}`;
      } else if (activeTab === 'confirmed') {
        endpoint = `/reprint/api/table/${tableId}/confirmed-list/?q=${searchQuery}&offset=${offset}&limit=${limit}`;
      }

      if (!endpoint) return;

      const { ok, data } = await apiGet(endpoint);
      if (ok && data?.status === 'ok') {
        const items = data.items || [];
        if (append) {
          setCards(prev => [...prev, ...items]);
        } else {
          setCards(items);
        }
        setHasMore(data.has_more || false);
      } else {
        throw new Error(data?.message || 'Failed to load reprint data');
      }

      // Refresh segment tab counts
      const countsRes = await apiGet(`/reprint/api/table/${tableId}/step-counts/`);
      if (countsRes.ok && countsRes.data?.status === 'ok') {
        setCounts({
          download_list: countsRes.data.download_list || 0,
          request_list: countsRes.data.request_list || 0,
          confirmed: countsRes.data.confirmed || 0
        });
      }
    } catch (e) {
      setError(e.message?.includes('Network') ? 'Connection failed. Pull down to retry.' : 'Failed to load reprints');
    }
  }, [tableId, activeTab, searchQuery]);

  // Reload when tab or search query changes
  useEffect(() => {
    setPage(1);
    setCards([]);
    (async () => {
      setLoading(true);
      await loadCards(1);
      setLoading(false);
    })();
  }, [activeTab, searchQuery, loadCards]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setPage(1);
    await loadCards(1);
    setRefreshing(false);
  }, [loadCards]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    const next = page + 1;
    setPage(next);
    await loadCards(next, true);
    setLoadingMore(false);
  }, [hasMore, loadingMore, page, loadCards]);

  // ── Actions ─────────────────────────────────────────────────────────────
  
  const submitReprintRequest = async (cardId, studentName, afterEdit = false) => {
    setUpdating(cardId);
    try {
      const { ok, data } = await apiPost(`/reprint/api/table/${tableId}/request/`, {
        card_ids: [cardId],
        reason: afterEdit ? 'Requested with Edit from Mobile App' : 'Requested from Mobile App'
      });
      if (ok && data?.status === 'ok') {
        showToast(data.message || 'Reprint request created!', 'success');
        await loadCards(1);
      } else {
        showToast(data?.message || 'Failed to request reprint', 'error');
      }
    } catch (e) {
      showToast('Network error', 'error');
    }
    setUpdating(null);
  };

  // 1. Request Reprint
  const handleRequestReprint = (cardId, studentName) => {
    setReprintConfirmModal({ visible: true, cardId, name: studentName });
  };

  // 2. Confirm Request (Admin Only)
  const handleConfirmRequest = (rrId, studentName) => {
    Alert.alert(
      'Confirm Reprint',
      `Are you sure you want to confirm the reprint request for ${studentName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Confirm', 
          onPress: async () => {
            setUpdating(rrId);
            try {
              const { ok, data } = await apiPost(`/reprint/api/table/${tableId}/confirm/`, {
                rr_ids: [rrId]
              });
              if (ok && data?.status === 'ok') {
                showToast(data.message || 'Reprint confirmed!', 'success');
                setCards(prev => prev.filter(c => c.rr_id !== rrId));
                setCounts(prev => ({
                  ...prev,
                  request_list: Math.max(0, prev.request_list - 1),
                  confirmed: prev.confirmed + 1
                }));
              } else {
                showToast(data?.message || 'Failed to confirm request', 'error');
              }
            } catch (e) {
              showToast('Network error', 'error');
            }
            setUpdating(null);
          }
        }
      ]
    );
  };

  // 3. Retrieve Request (Admin Only)
  const handleRetrieveRequest = (rrId, studentName) => {
    Alert.alert(
      'Retrieve Request',
      `Move ${studentName} back to Reprint Requests list?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Retrieve', 
          onPress: async () => {
            setUpdating(rrId);
            try {
              const { ok, data } = await apiPost(`/reprint/api/table/${tableId}/retrieve/`, {
                rr_ids: [rrId]
              });
              if (ok && data?.status === 'ok') {
                showToast(data.message || 'Request retrieved!', 'success');
                setCards(prev => prev.filter(c => c.rr_id !== rrId));
                setCounts(prev => ({
                  ...prev,
                  confirmed: Math.max(0, prev.confirmed - 1),
                  request_list: prev.request_list + 1
                }));
              } else {
                showToast(data?.message || 'Failed to retrieve request', 'error');
              }
            } catch (e) {
              showToast('Network error', 'error');
            }
            setUpdating(null);
          }
        }
      ]
    );
  };

  // 4. Reject Request (Admin Only)
  const handleRejectRequest = (rrId, studentName) => {
    Alert.alert(
      'Reject Request',
      `Are you sure you want to reject and delete this reprint request for ${studentName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Reject', 
          style: 'destructive',
          onPress: async () => {
            setUpdating(rrId);
            try {
              const { ok, data } = await apiPost(`/reprint/api/table/${tableId}/reject/`, {
                rr_ids: [rrId]
              });
              if (ok && data?.status === 'ok') {
                showToast(data.message || 'Request rejected!', 'success');
                setCards(prev => prev.filter(c => c.rr_id !== rrId));
                setCounts(prev => ({
                  ...prev,
                  request_list: activeTab === 'request_list' ? Math.max(0, prev.request_list - 1) : prev.request_list,
                  confirmed: activeTab === 'confirmed' ? Math.max(0, prev.confirmed - 1) : prev.confirmed,
                  download_list: prev.download_list // download list count remains same
                }));
              } else {
                showToast(data?.message || 'Failed to reject request', 'error');
              }
            } catch (e) {
              showToast('Network error', 'error');
            }
            setUpdating(null);
          }
        }
      ]
    );
  };

  // ── Render Helpers ──────────────────────────────────────────────────────
  const getFieldValue = (fields, possibleNames) => {
    if (!Array.isArray(fields)) return '';
    const match = fields.find(f => 
      possibleNames.some(p => (f.name || '').toUpperCase() === p.toUpperCase())
    );
    return match ? match.value : '';
  };

  const getPhotoUrl = (fields) => {
    if (!Array.isArray(fields)) return '';
    const match = fields.find(f => {
      const type = (f.type || '').toLowerCase();
      const name = (f.name || '').toLowerCase();
      return type.includes('image') || type.includes('photo') || type.includes('file') ||
             name.includes('photo') || name.includes('image') || name.includes('picture') || name.includes('pic') || name.includes('img');
    });
    return match ? match.value : '';
  };

  const renderItem = useCallback(({ item }) => {
    const cardId = item.card_id;
    const keyId = item.rr_id || cardId;
    const name = getFieldValue(item.ordered_fields, ['NAME', 'FULL NAME', 'STUDENT NAME', 'FULL_NAME', 'STUDENT_NAME', 'CLASS']) || `Card #${cardId}`;
    const parentName = getFieldValue(item.ordered_fields, ['FATHER NAME', 'FATHER_NAME', 'MOTHER NAME', 'MOTHER_NAME', 'GUARDIAN NAME']);
    const classVal = getFieldValue(item.ordered_fields, ['CLASS', 'CLASS_NAME']);
    const secVal = getFieldValue(item.ordered_fields, ['SECTION', 'SEC']);
    const photoUrl = getPhotoUrl(item.ordered_fields);
    const isUpdating = updating === keyId;

    const finalPhotoUrl = resolveAdarshImageUrl(photoUrl);

    return (
      <View style={s.card}>
        <TouchableOpacity style={s.cardTop} activeOpacity={0.7} onPress={() => navigation.navigate('CardDetail', { cardId })}>
          <View style={s.photoWrap}>
            {photoUrl ? (
              <Image 
                source={{ 
                  uri: finalPhotoUrl,
                  headers: {
                    Cookie: getSessionCookies()
                  }
                }} 
                style={s.photo} 
              />
            ) : (
              <View style={s.photoPlaceholder}><DynamicIcon name="user" size={14} color={colors.gray300} /></View>
            )}
          </View>
          <View style={s.cardInfo}>
            <Text style={s.cardName} numberOfLines={1}>{name}</Text>
            {!!parentName && <Text style={s.cardSub} numberOfLines={1}>S/O: {parentName}</Text>}
            <View style={s.metaRow}>
              {!!classVal && <Text style={s.classBadge}>{classVal}{secVal ? ` - ${secVal}` : ''}</Text>}
              <StatusBadge status={activeTab === 'download_list' ? 'download' : (activeTab === 'request_list' ? 'pending' : 'approved')} size="sm" />
            </View>
            {activeTab !== 'download_list' && item.requested_by_name && (
              <Text style={s.requestedByText}>By: {item.requested_by_name} • {item.requested_at || item.confirmed_at}</Text>
            )}
          </View>
          <DynamicIcon name="chevron-right" size={10} color={colors.gray300} />
        </TouchableOpacity>

        <View style={s.cardActions}>
          {isUpdating ? (
            <ActivityIndicator size="small" color={theme.primary} />
          ) : (
            <>
              {activeTab === 'download_list' && canRequestReprint && (
                <TouchableOpacity
                  style={[s.actionBtn, { backgroundColor: '#fef3c7', flex: 1, justifyContent: 'center' }]}
                  onPress={() => handleRequestReprint(cardId, name)}
                  activeOpacity={0.7}
                >
                  <DynamicIcon name="redo" size={11} color="#b45309" style={{ marginRight: 6 }} />
                  <Text style={[s.actionText, { color: '#b45309' }]}>Request Reprint</Text>
                </TouchableOpacity>
              )}

              {activeTab === 'request_list' && (
                isAdminOrOperator ? (
                  <>
                    <TouchableOpacity
                      style={[s.actionBtn, { backgroundColor: '#d1fae5', flex: 1, justifyContent: 'center' }]}
                      onPress={() => handleConfirmRequest(item.rr_id, name)}
                      activeOpacity={0.7}
                    >
                      <DynamicIcon name="check" size={11} color="#047857" style={{ marginRight: 6 }} />
                      <Text style={[s.actionText, { color: '#047857' }]}>Confirm</Text>
                    </TouchableOpacity>
                    <View style={{ width: 10 }} />
                    <TouchableOpacity
                      style={[s.actionBtn, { backgroundColor: '#fef2f2', flex: 1, justifyContent: 'center' }]}
                      onPress={() => handleRejectRequest(item.rr_id, name)}
                      activeOpacity={0.7}
                    >
                      <DynamicIcon name="times" size={11} color="#b91c1c" style={{ marginRight: 6 }} />
                      <Text style={[s.actionText, { color: '#b91c1c' }]}>Reject</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <View style={s.nonAdminStatus}>
                    <DynamicIcon name="clock" size={10} color="#b45309" style={{ marginRight: 6 }} />
                    <Text style={s.nonAdminStatusText}>Pending Admin Confirmation</Text>
                  </View>
                )
              )}

              {activeTab === 'confirmed' && (
                isAdminOrOperator ? (
                  <>
                    <TouchableOpacity
                      style={[s.actionBtn, { backgroundColor: '#fff7ed', flex: 1, justifyContent: 'center' }]}
                      onPress={() => handleRetrieveRequest(item.rr_id, name)}
                      activeOpacity={0.7}
                    >
                      <DynamicIcon name="undo" size={11} color="#c2410c" style={{ marginRight: 6 }} />
                      <Text style={[s.actionText, { color: '#c2410c' }]}>Retrieve</Text>
                    </TouchableOpacity>
                    <View style={{ width: 10 }} />
                    <TouchableOpacity
                      style={[s.actionBtn, { backgroundColor: '#fef2f2', flex: 1, justifyContent: 'center' }]}
                      onPress={() => handleRejectRequest(item.rr_id, name)}
                      activeOpacity={0.7}
                    >
                      <DynamicIcon name="times" size={11} color="#b91c1c" style={{ marginRight: 6 }} />
                      <Text style={[s.actionText, { color: '#b91c1c' }]}>Reject</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <View style={s.nonAdminStatus}>
                    <DynamicIcon name="check-circle" size={10} color="#047857" style={{ marginRight: 6 }} />
                    <Text style={s.nonAdminStatusText}>Confirmed for Printing</Text>
                  </View>
                )
              )}
            </>
          )}
        </View>
      </View>
    );
  }, [updating, activeTab, theme, isAdminOrOperator]);

  // Segment Tab Bar Items
  const tabs = [];
  if (hasDownloadTab) tabs.push({ key: 'download_list', label: 'Download List', icon: 'download', count: counts.download_list });
  if (hasRequestTab) tabs.push({ key: 'request_list', label: 'Requested', icon: 'clock', count: counts.request_list });
  if (hasConfirmedTab) tabs.push({ key: 'confirmed', label: 'Confirmed', icon: 'check-circle', count: counts.confirmed });

  return (
    <View style={s.root}>
      <TopBar title="Reprint Detail" subtitle={tableName || `Table #${tableId}`} onBack={() => navigation.goBack()} />
      
      {/* 3-Tab workflow Segment Bar */}
      {tabs.length > 1 && (
        <View style={s.tabsWrapper}>
          {tabs.map(tab => (
            <TouchableOpacity
              key={tab.key}
              style={[s.tabButton, activeTab === tab.key && s.tabButtonActive]}
              onPress={() => setActiveTab(tab.key)}
              activeOpacity={0.7}
            >
              <DynamicIcon name={tab.icon} size={11} color={activeTab === tab.key ? theme.primary : colors.gray400} style={{ marginRight: 6 }} />
              <Text style={[s.tabText, activeTab === tab.key && [s.tabTextActive, { color: theme.primary }]]}>
                {tab.label} ({tab.count || 0})
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Real-time debounced Search bar */}
      <View style={s.searchBarWrap}>
        <View style={s.searchBar}>
          <DynamicIcon name="search" size={12} color={colors.gray400} style={{ marginRight: 8 }} />
          <TextInput
            placeholder="Search student names, class, roll..."
            value={searchText}
            onChangeText={setSearchText}
            style={s.searchInput}
            placeholderTextColor={colors.gray400}
          />
          {searchText.length > 0 && (
            <TouchableOpacity onPress={() => setSearchText('')} style={{ padding: 4 }}>
              <DynamicIcon name="times" size={10} color={colors.gray400} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {error && <ErrorBanner message={error} onRetry={() => loadCards(1)} onDismiss={() => setError(null)} />}
      
      {loading ? (
        <CardListSkeleton />
      ) : (
        <FlatList
          data={cards}
          renderItem={renderItem}
          keyExtractor={(item, index) => (item.rr_id || item.card_id || index).toString()}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandLight} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={loadingMore ? <ActivityIndicator style={{ padding: 16 }} color={colors.brandLight} /> : null}
          ListEmptyComponent={
            <View style={s.empty}>
              <View style={s.emptyIcon}><DynamicIcon name="redo" size={24} color={colors.gray300} /></View>
              <Text style={s.emptyTitle}>No cards in {activeTab === 'download_list' ? 'Download' : activeTab === 'request_list' ? 'Requested' : 'Confirmed'} list</Text>
              <Text style={s.emptySub}>
                {activeTab === 'download_list' 
                  ? 'All eligible reprint cards have already been requested.' 
                  : activeTab === 'request_list'
                  ? 'No reprint requests currently pending.'
                  : 'No reprint requests have been confirmed yet.'
                }
              </Text>
              
              {/* Easy Transition Buttons */}
              {activeTab === 'request_list' && hasDownloadTab && (
                <TouchableOpacity 
                  style={[s.transitionBtn, { backgroundColor: theme.primary }]} 
                  onPress={() => setActiveTab('download_list')}
                >
                  <DynamicIcon name="download" size={11} color="#fff" style={{ marginRight: 6 }} />
                  <Text style={s.transitionBtnText}>Go to Download List</Text>
                </TouchableOpacity>
              )}
              
              {activeTab === 'confirmed' && hasRequestTab && (
                <TouchableOpacity 
                  style={[s.transitionBtn, { backgroundColor: theme.primary }]} 
                  onPress={() => setActiveTab('request_list')}
                >
                  <DynamicIcon name="clock" size={11} color="#fff" style={{ marginRight: 6 }} />
                  <Text style={s.transitionBtnText}>Go to Requested List</Text>
                </TouchableOpacity>
              )}

              {activeTab === 'download_list' && hasRequestTab && (
                <TouchableOpacity 
                  style={[s.transitionBtn, { backgroundColor: theme.primary }]} 
                  onPress={() => setActiveTab('request_list')}
                >
                  <DynamicIcon name="clock" size={11} color="#fff" style={{ marginRight: 6 }} />
                  <Text style={s.transitionBtnText}>Go to Requested List</Text>
                </TouchableOpacity>
              )}
            </View>
          }
        />
      )}
      <Toast visible={toast.visible} message={toast.message} type={toast.type} onHide={() => setToast(p => ({...p, visible: false}))} />
      
      {/* Reprint Confirm Selection Modal */}
      <Modal
        visible={reprintConfirmModal.visible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setReprintConfirmModal(p => ({ ...p, visible: false }))}
      >
        <View style={s.modalOverlay}>
          <TouchableWithoutFeedback onPress={() => setReprintConfirmModal(p => ({ ...p, visible: false }))}>
            <View style={s.modalBackground} />
          </TouchableWithoutFeedback>
          <View style={s.modalContent}>
            <View style={s.modalHeader}>
              <DynamicIcon name="redo" size={16} color="#b45309" style={{ marginRight: 8 }} />
              <Text style={s.modalTitle}>Confirm Reprint Request</Text>
            </View>
            <View style={s.modalBody}>
              <Text style={s.modalBodyText}>
                Do you want to edit the details for <Text style={{ fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray800 }}>{reprintConfirmModal.name}</Text> first, or request reprint without edit?
              </Text>
            </View>
            <View style={s.modalActions}>
              <TouchableOpacity 
                style={[s.modalBtn, { backgroundColor: theme.primary, marginBottom: 8 }]}
                onPress={() => {
                  const { cardId } = reprintConfirmModal;
                  setReprintConfirmModal(p => ({ ...p, visible: false }));
                  setEditingCardId(cardId);
                  setShowEditForm(true);
                }}
                activeOpacity={0.7}
              >
                <DynamicIcon name="edit" size={12} color="#fff" style={{ marginRight: 6 }} />
                <Text style={s.modalBtnText}>Edit Details First</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={[s.modalBtn, { backgroundColor: '#fef3c7', borderWidth: 1, borderColor: '#f59e0b', marginBottom: 8 }]}
                onPress={() => {
                  const { cardId, name } = reprintConfirmModal;
                  setReprintConfirmModal(p => ({ ...p, visible: false }));
                  submitReprintRequest(cardId, name, false);
                }}
                activeOpacity={0.7}
              >
                <DynamicIcon name="check" size={12} color="#b45309" style={{ marginRight: 6 }} />
                <Text style={[s.modalBtnText, { color: '#b45309' }]}>Request Without Edit</Text>
              </TouchableOpacity>

              <TouchableOpacity 
                style={[s.modalBtn, { backgroundColor: '#f3f4f6' }]}
                onPress={() => setReprintConfirmModal(p => ({ ...p, visible: false }))}
                activeOpacity={0.7}
              >
                <Text style={[s.modalBtnText, { color: colors.gray500 }]}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Card Edit Form for Reprint with Edit */}
      <CardModalForm 
        visible={showEditForm}
        onClose={() => {
          setShowEditForm(false);
          setEditingCardId(null);
        }}
        cardId={editingCardId}
        tableId={tableId}
        onSuccess={() => {
          submitReprintRequest(editingCardId, reprintConfirmModal.name, true);
        }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceBg },
  tabsWrapper: { 
    flexDirection: 'row', 
    marginHorizontal: 16, 
    marginTop: 12, 
    backgroundColor: '#fff', 
    borderRadius: radius.md, 
    borderWidth: 1, 
    borderColor: '#e2e8f0', 
    overflow: 'hidden',
    ...shadows.sm
  },
  tabButton: { 
    flex: 1, 
    paddingVertical: 12, 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'center',
    borderRightWidth: 1,
    borderRightColor: '#f1f5f9'
  },
  tabButtonActive: {
    backgroundColor: 'rgba(51,183,239,0.06)',
  },
  tabText: { 
    fontSize: 10, 
    fontFamily: 'SairaSemiCondensed-Bold', 
    color: colors.gray400 
  },
  tabTextActive: { 
    fontFamily: 'SairaSemiCondensed-Bold' 
  },
  searchBarWrap: {
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 12,
    height: 40,
    ...shadows.sm
  },
  searchInput: {
    flex: 1,
    fontSize: 11,
    fontFamily: 'SairaSemiCondensed-Medium',
    color: colors.gray800,
    paddingVertical: 0
  },
  list: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 40 },
  card: { backgroundColor: '#fff', borderRadius: radius.lg, marginBottom: 10, borderWidth: 1, borderColor: '#f1f5f9', overflow: 'hidden', ...shadows.sm },
  cardTop: { flexDirection: 'row', alignItems: 'center', padding: 12 },
  photoWrap: { width: 48, height: 58, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.gray50, borderWidth: 1, borderColor: colors.gray100 },
  photo: { width: '100%', height: '100%', resizeMode: 'cover' },
  photoPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  cardInfo: { flex: 1, marginLeft: 12 },
  cardName: { fontSize: 13, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray800, marginBottom: 2 },
  cardSub: { fontSize: 9, color: colors.gray400, fontFamily: 'SairaSemiCondensed-Medium', marginBottom: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  classBadge: { fontSize: 8, fontFamily: 'SairaSemiCondensed-Bold', color: colors.brandPrimary, backgroundColor: colors.indigo50, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.xs },
  requestedByText: { fontSize: 8, color: colors.gray400, fontFamily: 'SairaSemiCondensed-Medium', marginTop: 6 },
  cardActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, paddingBottom: 12 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.sm },
  actionText: { fontSize: 10, fontFamily: 'SairaSemiCondensed-Bold' },
  nonAdminStatus: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', width: '100%', paddingVertical: 6 },
  nonAdminStatusText: { fontSize: 9, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray500 },
  empty: { padding: 48, alignItems: 'center', justifyContent: 'center', marginTop: 32 },
  emptyIcon: { width: 64, height: 64, borderRadius: radius.xxl, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', marginBottom: 16, ...shadows.sm },
  emptyTitle: { fontSize: 13, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray800, marginBottom: 4 },
  emptySub: { fontSize: 11, color: colors.gray400, textAlign: 'center', fontFamily: 'SairaSemiCondensed-Medium', marginBottom: 16 },
  transitionBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.sm, ...shadows.sm },
  transitionBtnText: { color: '#fff', fontSize: 10, fontFamily: 'SairaSemiCondensed-Bold' },
  // Modal Styles
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  modalBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  modalContent: {
    width: width - 40,
    backgroundColor: '#fff',
    borderRadius: radius.lg,
    padding: 20,
    ...shadows.xl,
    elevation: 5,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  modalTitle: {
    fontSize: 15,
    fontFamily: 'SairaSemiCondensed-Bold',
    color: colors.gray800,
  },
  modalBody: {
    marginBottom: 20,
  },
  modalBodyText: {
    fontSize: 12,
    fontFamily: 'SairaSemiCondensed-Medium',
    color: colors.gray600,
    lineHeight: 18,
  },
  modalActions: {
    width: '100%',
  },
  modalBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: radius.sm,
    width: '100%',
  },
  modalBtnText: {
    fontSize: 12,
    fontFamily: 'SairaSemiCondensed-Bold',
    color: '#fff',
  },
});
