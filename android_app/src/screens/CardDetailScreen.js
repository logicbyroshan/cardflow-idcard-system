import React, { useState, useMemo, useCallback } from 'react';
import { 
  View, Text, ScrollView, TouchableOpacity, Image, 
  StyleSheet, Alert, RefreshControl, ActivityIndicator 
} from 'react-native';
import { Linking } from 'react-native';
import { DynamicIcon, IconClock, IconWarning, IconList, IconEdit, IconDownload, IconTrash, IconLock, IconFilter, IconCheck, IconThumbsUp, IconPool } from '../components/Icons';
import { LinearGradient } from 'expo-linear-gradient';
import TopBar from '../components/TopBar';
import Toast from '../components/Toast';
import StatusBadge from '../components/StatusBadge';
import { DetailSkeleton } from '../components/Skeleton';
import CardModalForm from '../components/CardModalForm';
import { apiGet, apiPost, BASE_URL, getSessionCookies, resolveAdarshImageUrl } from '../api/client';
import { colors, radius, shadows, roleThemes, fontFamily } from '../theme';
import { useAuth } from '../context/AuthContext';
import useRefreshableResource from '../hooks/useRefreshableResource';

export default function CardDetailScreen({ navigation, route }) {
  const cardId = route?.params?.cardId;
  const { user } = useAuth();
  const theme = roleThemes[user?.role] || roleThemes.default;

  const [updating, setUpdating] = useState(false);
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });
  const [showForm, setShowForm] = useState(false);

  const showToast = (msg, type = 'info') => setToast({ visible: true, message: msg, type });

  const loadCard = useCallback(async () => {
    try {
      const { ok, data } = await apiGet(`/api/mobile/card/${cardId}/detail/`);
      if (ok && data?.success) {
        return data.data;
      } else {
        throw new Error(data?.message || 'Failed to load card details');
      }
    } catch (e) {
      throw new Error('Network error - check your connection');
    }
  }, [cardId]);

  const { data: card, loading, refreshing, error, refresh } = useRefreshableResource(loadCard);

  const isLocked = (user?.isClient || user?.isAssistant) && card && ['approved', 'download', 'pool'].includes(card.status);

  const canTransitionTo = useCallback((targetStatus) => {
    if (!card) return false;
    if (isLocked) return false;
    if (card.status === targetStatus) return true;
    
    const allowed = {
      'pending':  ['verified', 'pool'],
      'verified': ['approved', 'pending', 'pool'],
      'approved': ['download', 'verified', 'pending', 'pool'],
      'download': ['approved', 'pending'],
      'pool':     ['pending'],
      'reprint':  ['download', 'verified', 'approved', 'pending'],
    }[card.status] || [];
    
    if (!allowed.includes(targetStatus)) return false;
    
    const isSuperAdmin = user?.isSuperAdmin || user?.role === 'super_admin' || user?.role === 'admin';
    if (isSuperAdmin) return true;
    
    // Allow clients/assistants to delete (move to pool) pending cards if they have delete permission
    const perms = user?.permissions || {};
    if (targetStatus === 'pool' && card.status === 'pending' && perms.perm_idcard_delete) {
      return true;
    }
    if (card.status === 'pool' && targetStatus === 'pending') {
      const isClient = user?.role === 'client' || user?.role === 'client_staff' || user?.role === 'guest_user';
      return !!(perms.perm_idcard_retrieve || isClient);
    }
    if (card.status === 'download' && targetStatus === 'pending') {
      return !!perms.perm_idcard_retrieve;
    }
    
    const requiredPerm = {
      'verified': 'perm_idcard_verify',
      'approved': 'perm_idcard_approve',
      'download': 'perm_idcard_approve',
      'pending':  'perm_idcard_verify',
      'pool':     'perm_idcard_delete',
    }[targetStatus];
    
    return !!perms[requiredPerm];
  }, [card?.status, isLocked, user]);

  const allowedStatuses = useMemo(() => {
    const perms = user?.permissions || {};
    const isSuperAdmin = user?.isSuperAdmin || user?.role === 'super_admin' || user?.role === 'admin';
    return [
      { key: 'pending', label: 'Pending', perm: 'perm_idcard_pending_list' },
      { key: 'verified', label: 'Verified', perm: 'perm_idcard_verified_list' },
      { key: 'approved', label: 'Approved', perm: 'perm_idcard_approved_list' },
      { key: 'download', label: 'Download', perm: 'perm_idcard_download_list' },
      { key: 'reprint', label: 'Reprint', perm: 'perm_idcard_reprint_list' },
      { key: 'pool', label: 'Pool', perm: 'perm_idcard_pool_list' },
    ].filter(opt => isSuperAdmin || !opt.perm || perms[opt.perm]);
  }, [user]);

  const updateStatus = async (status) => {
    setUpdating(true);
    try {
      const { data } = await apiPost(`/api/mobile/card/${cardId}/status/`, { status });
      showToast(data?.success ? 'Status updated!' : (data?.message || 'Failed'), data?.success ? 'success' : 'error');
      if (data?.success) refresh();
    } catch (e) { showToast('Network error', 'error'); }
    setUpdating(false);
  };

  const deleteCard = () => {
    Alert.alert('Move to Pool?', 'This will move the card to the pool.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Move to Pool', style: 'destructive', onPress: async () => {
        try {
          const { data } = await apiPost(`/api/mobile/card/${cardId}/delete/`, {});
          if (data?.success) {
            showToast('Moved to pool', 'success');
            setTimeout(() => navigation.goBack(), 800);
          } else showToast(data?.message || 'Move failed', 'error');
        } catch (e) { showToast('Network error', 'error'); }
      }},
    ]);
  };

    const downloadCard = async () => {
      try {
        const url = `${BASE_URL}/api/mobile/card/${cardId}/download-pdf/`;
        Linking.openURL(url);
      } catch (e) {
        showToast('Could not download card', 'error');
      }
    };
  if (loading) return (
    <View style={s.root}><TopBar title="Card Detail" onBack={() => navigation.goBack()} /><DetailSkeleton /></View>
  );

  if (!card) return (
    <View style={s.root}>
      <TopBar title="Card Detail" onBack={() => navigation.goBack()} />
      <View style={s.center}><Text style={s.errText}>{error || 'Card not found'}</Text></View>
    </View>
  );

  const fd = card.field_data || {};
  const cardName = card.name || fd.NAME || fd.Name || fd.name || fd.FULL_NAME || fd.full_name || `Card #${card.id}`;

  const photoVal = card.photo_url || '';
  const isPending = photoVal.includes('PENDING:');
  const isEmpty = !photoVal || photoVal === 'NOT_FOUND';
  const isComplete = !isPending && !isEmpty;

  return (
    <View style={s.root}>
      <TopBar title="Card Details" subtitle={cardName} onBack={() => navigation.goBack()} />
      
      <ScrollView 
        style={s.scroll} 
        contentContainerStyle={s.scrollC} 
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.brandLight} />}
      >
        <LinearGradient colors={['#fff', '#f8fafc']} style={s.heroCard}>
          <View style={s.heroTop}>
            <View style={[s.photoFrame, isPending && { backgroundColor: '#fef08a' }, isEmpty && { backgroundColor: '#f1f5f9' }]}>
              {isComplete ? (
                <Image 
                  source={{ 
                    uri: resolveAdarshImageUrl(card.photo_url),
                    headers: {
                      Cookie: getSessionCookies()
                    }
                  }} 
                  style={s.photo} 
                />
              ) : (
                <View style={[s.photoPlaceholder, isPending && { backgroundColor: '#fef08a' }, isEmpty && { backgroundColor: '#f1f5f9' }]}>
                  <DynamicIcon name={isPending ? 'clock' : 'user-alt-slash'} size={24} color={isPending ? "#ca8a04" : "#cbd5e1"} />
                  <Text style={[s.emptyPhotoText, { color: isPending ? "#ca8a04" : "#94a3b8" }]}>{isPending ? 'PENDING' : 'EMPTY'}</Text>
                </View>
              )}
            </View>
            <View style={s.heroInfo}>
              <Text style={s.cardName}>{cardName}</Text>
              <Text style={s.tableName}>{card.table_name || 'Unassigned Table'}</Text>
              <View style={s.statusLine}>
                <StatusBadge status={card.status} showIcon size="lg" />
                <View style={s.vLine} />
                <Text style={s.srNo}>SR: {card.sr_no || '-'}</Text>
              </View>
            </View>
          </View>
        </LinearGradient>

        <View style={s.section}>
          <View style={s.sectionHeader}>
            <IconList size={12} color={colors.gray400} />
            <Text style={s.sectionTitle}>FIELD DATA</Text>
          </View>
          <View style={s.fieldsList}>
            {(card.ordered_fields || []).length > 0 ? (
              card.ordered_fields.map((f, i) => {
                const val = fd[f.name];
                const isEmpty = !val || val === 'NOT_FOUND' || val === 'null' || val === 'undefined';
                const isImage = ['photo', 'rel_photo', 'mother_photo', 'father_photo', 'barcode', 'qr_code', 'signature', 'image'].includes((f.type || '').toLowerCase());
                const isPendingVal = !isEmpty && typeof val === 'string' && val.startsWith('PENDING:');

                return (
                  <View key={f.name} style={[s.fieldRow, i === 0 && { borderTopWidth: 0 }, isImage && { flexDirection: 'column', alignItems: 'flex-start' }]}>
                    <Text style={s.fieldKey}>{f.name}</Text>
                    {isImage && !isEmpty ? (
                      isPendingVal ? (
                        <View style={{ backgroundColor: '#fffbeb', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, marginTop: 4 }}>
                          <Text style={{ fontSize: 10, fontFamily: 'SairaSemiCondensed-Bold', color: '#d97706' }}>PENDING UPLOAD</Text>
                        </View>
                      ) : (
                        <Image 
                          source={{ 
                            uri: resolveAdarshImageUrl(val),
                            headers: { Cookie: getSessionCookies() }
                          }} 
                          style={{ width: 120, height: 75, borderRadius: 4, marginTop: 6, borderWidth: 1, borderColor: '#e2e8f0', backgroundColor: '#f8fafc' }}
                          resizeMode="contain"
                        />
                      )
                    ) : (
                      <Text style={[s.fieldVal, isEmpty && s.fieldValEmpty]}>{isEmpty ? 'NOT ADDED' : String(val).toUpperCase()}</Text>
                    )}
                  </View>
                );
              })
            ) : (
              Object.entries(fd).map(([key, val], i) => {
                const isEmpty = !val || val === 'NOT_FOUND' || val === 'null' || val === 'undefined';
                const isImage = ['photo', 'signature', 'barcode', 'qr_code', 'image'].some(k => key.toLowerCase().includes(k));
                const isPendingVal = !isEmpty && typeof val === 'string' && val.startsWith('PENDING:');

                return (
                  <View key={key} style={[s.fieldRow, i === 0 && { borderTopWidth: 0 }, isImage && { flexDirection: 'column', alignItems: 'flex-start' }]}>
                    <Text style={s.fieldKey}>{key.replace(/_/g, ' ')}</Text>
                    {isImage && !isEmpty ? (
                      isPendingVal ? (
                        <View style={{ backgroundColor: '#fffbeb', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, marginTop: 4 }}>
                          <Text style={{ fontSize: 10, fontFamily: 'SairaSemiCondensed-Bold', color: '#d97706' }}>PENDING UPLOAD</Text>
                        </View>
                      ) : (
                        <Image 
                          source={{ 
                            uri: resolveAdarshImageUrl(val),
                            headers: { Cookie: getSessionCookies() }
                          }} 
                          style={{ width: 120, height: 75, borderRadius: 4, marginTop: 6, borderWidth: 1, borderColor: '#e2e8f0', backgroundColor: '#f8fafc' }}
                          resizeMode="contain"
                        />
                      )
                    ) : (
                      <Text style={[s.fieldVal, isEmpty && s.fieldValEmpty]}>{isEmpty ? 'NOT ADDED' : String(val).toUpperCase()}</Text>
                    )}
                  </View>
                );
              })
            )}
            {Object.keys(fd).length === 0 && !(card.ordered_fields || []).length && (
              <View style={s.emptyFields}><Text style={s.emptyFieldsText}>No field data available</Text></View>
            )}
          </View>
        </View>

        <View style={s.actions}>
          {!isLocked && user?.permissions?.perm_idcard_edit && (
            <TouchableOpacity 
              onPress={() => setShowForm(true)} 
              activeOpacity={0.8} 
              style={[s.actionBtnFull, { borderColor: colors.brandPrimary, marginTop: 0, marginBottom: 12 }]}
            >
              <Text style={[s.actionBtnText, { color: colors.brandPrimary }]}>EDIT INFORMATION</Text>
            </TouchableOpacity>
          )}

          {isLocked && (
            <View style={s.lockedNote}>
              <IconLock size={12} color={colors.gray400} />
              <Text style={s.lockedNoteText}>Card is locked (Status: {card.status})</Text>
            </View>
          )}

          <View style={s.statusGrid}>
            {allowedStatuses.map(opt => {
              const canTransition = card.status === opt.key || canTransitionTo(opt.key);
              return (
                <TouchableOpacity 
                  key={opt.key} 
                  onPress={() => updateStatus(opt.key)} 
                  disabled={updating || isLocked || !canTransition} 
                  style={[s.statusOption, !canTransition && { opacity: 0.3 }]}
                >
                  <StatusBadge status={opt.key} variant={card.status === opt.key ? 'solid' : 'glass'} />
                </TouchableOpacity>
              );
            })}
          </View>

          {card.status === 'pending' && user?.permissions?.perm_idcard_delete && (
            <TouchableOpacity 
              onPress={deleteCard} 
              activeOpacity={0.8}
              style={[s.actionBtnFull, { borderColor: colors.red, backgroundColor: '#fef2f2', marginTop: 12 }]}
            >
              <Text style={[s.actionBtnText, { color: colors.red }]}>MOVE TO POOL</Text>
            </TouchableOpacity>
          )}
        </View>

          <View style={s.section}>
            <View style={s.sectionHeader}>
              <IconFilter size={12} color={colors.gray400} />
              <Text style={s.sectionTitle}>CHANGE STATUS</Text>
            </View>
            <View style={s.statusButtonsWrap}>
              {allowedStatuses.map((opt, idx) => {
                const canTransition = card.status === opt.key || canTransitionTo(opt.key);
                return (
                  <TouchableOpacity 
                    key={opt.key} 
                    onPress={() => updateStatus(opt.key)} 
                    disabled={updating || isLocked || !canTransition} 
                    activeOpacity={0.75}
                    style={[
                      s.statusBtn,
                      card.status === opt.key && s.statusBtnActive,
                      { backgroundColor: card.status === opt.key ? colors.brandPrimary : '#f8fafc', borderColor: card.status === opt.key ? colors.brandPrimary : colors.gray100 },
                      !canTransition && { opacity: 0.3 }
                    ]}
                  >
                    <DetailStatusIcon status={opt.key} size={11} color={card.status === opt.key ? '#fff' : colors.gray600} />
                    <Text style={[s.statusBtnText, card.status === opt.key && s.statusBtnTextActive, !canTransition && { color: colors.gray300 }]}>{opt.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={s.actionButtonsRow}>
            {!isLocked && user?.permissions?.perm_idcard_edit && (
              <TouchableOpacity 
                onPress={() => setShowForm(true)} 
                activeOpacity={0.8} 
                style={[s.actionBtnHalf, { borderColor: colors.brandPrimary }]}
              >
                <Text style={[s.actionBtnText, { color: colors.brandPrimary }]}>EDIT</Text>
              </TouchableOpacity>
            )}
          
            {user?.permissions?.perm_idcard_download_list && (
              <TouchableOpacity 
                onPress={downloadCard} 
                activeOpacity={0.8} 
                style={[s.actionBtnHalf, { borderColor: '#7c3aed' }]}
              >
                <Text style={[s.actionBtnText, { color: '#7c3aed' }]}>DOWNLOAD</Text>
              </TouchableOpacity>
            )}

            {card.status === 'pending' && user?.permissions?.perm_idcard_delete && (
              <TouchableOpacity 
                onPress={deleteCard} 
                activeOpacity={0.8} 
                style={[s.actionBtnFull, { borderColor: colors.red, backgroundColor: '#fef2f2' }]}
              >
                <Text style={[s.actionBtnText, { color: colors.red }]}>MOVE TO POOL</Text>
              </TouchableOpacity>
            )}
          </View>
        <View style={s.timestampRow}>
          <Text style={s.tsText}>Updated: {card.updated_at || '-'}</Text>
        </View>
      </ScrollView>
      <CardModalForm 
        visible={showForm} 
        onClose={() => setShowForm(false)} 
        tableId={card.table_id}
        cardId={card.id}
        onSuccess={() => loadCard(true)}
      />
      <Toast visible={toast.visible} message={toast.message} type={toast.type} onHide={() => setToast(p => ({...p, visible: false}))} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceBg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  scroll: { flex: 1 }, scrollC: { padding: 16, paddingBottom: 40 },
  heroCard: { backgroundColor: '#fff', borderRadius: radius.sm, padding: 20, borderWidth: 1, borderColor: '#f1f5f9', ...shadows.md, marginBottom: 20 },
  heroTop: { flexDirection: 'row' },
  photoFrame: { width: 90, height: 110, borderRadius: radius.xs, overflow: 'hidden', backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', ...shadows.sm },
  photo: { width: '100%', height: '100%' },
  photoPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fef2f2' },
  emptyPhotoText: { fontSize: 8, fontFamily: 'SairaSemiCondensed-Bold', color: '#fca5a5', marginTop: 4 },
  heroInfo: { flex: 1, justifyContent: 'center' },
  cardName: { fontSize: 20, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray800 },
  tableName: { fontSize: 13, color: colors.gray500, marginTop: 4, fontFamily: 'SairaSemiCondensed-Medium' },
  statusLine: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  vLine: { width: 1, height: 16, backgroundColor: '#e2e8f0' },
  srNo: { fontSize: 11, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray400 },
  section: { backgroundColor: '#fff', borderRadius: radius.sm, padding: 4, borderWidth: 1, borderColor: '#f1f5f9', ...shadows.sm, marginBottom: 20 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', padding: 16, paddingBottom: 8 },
  sectionTitle: { fontSize: 10, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray400, letterSpacing: 1.2, textTransform: 'uppercase' },
  fieldsList: { padding: 8 },
  fieldRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 8, borderTopWidth: 1, borderTopColor: '#f8fafc' },
  fieldKey: { fontSize: 11, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray400, textTransform: 'uppercase' },
  fieldVal: { fontSize: 13, fontFamily: 'SairaSemiCondensed-SemiBold', color: colors.gray700, flex: 1, textAlign: 'right', marginLeft: 20 },
  fieldValEmpty: { color: colors.gray300, fontStyle: 'italic', fontSize: 11 },
  emptyFields: { padding: 20, alignItems: 'center' },
  emptyFieldsText: { fontSize: 12, color: colors.gray400, fontStyle: 'italic' },
  actions: { },
  editBtnWrap: { borderRadius: radius.md, overflow: 'hidden', ...shadows.md },
  editBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 16 },
  editBtnText: { fontSize: 14, fontFamily: 'SairaSemiCondensed-Bold', color: '#fff' },
  lockedNote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 16, backgroundColor: colors.gray100, borderRadius: radius.md },
  lockedNoteText: { fontSize: 12, color: colors.gray500, fontFamily: 'SairaSemiCondensed-SemiBold' },
  statusGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginTop: 8 },
  statusOption: { minWidth: '30%' },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, marginTop: 10 },
  deleteBtnText: { fontSize: 12, color: '#ef4444', fontFamily: 'SairaSemiCondensed-SemiBold' },
  timestampRow: { marginTop: 24, alignItems: 'center' },
  tsText: { fontSize: 10, color: colors.gray400 },
  errText: { fontSize: 14, color: colors.error, textAlign: 'center' },

    // Status buttons grid styling
    statusButtonsWrap: { padding: 12, display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' },
    statusBtn: { flex: 1, minWidth: '30%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, paddingHorizontal: 8, borderRadius: radius.xs, borderWidth: 1, gap: 6 },
    statusBtnActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
    statusBtnText: { fontSize: 11, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray600, textAlign: 'center' },
    statusBtnTextActive: { color: '#fff' },
  
    // Bottom action buttons
    actionButtonsRow: { flexDirection: 'row', gap: 12, marginBottom: 20, marginTop: 16 },
    actionBtnHalf: { flex: 1, borderRadius: radius.sm, borderWidth: 1.5, borderColor: '#e2e8f0', backgroundColor: '#fff', paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
    actionBtnFull: { width: '100%', borderRadius: radius.sm, borderWidth: 1.5, borderColor: '#e2e8f0', backgroundColor: '#fff', paddingVertical: 12, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
    actionBtnText: { fontSize: 13, fontFamily: 'SairaSemiCondensed-Bold', textAlign: 'center' },
});

function DetailStatusIcon({ status, size, color }) {
  if (status === 'pending') return <IconClock size={size} color={color} />;
  if (status === 'verified') return <IconCheck size={size} color={color} />;
  if (status === 'approved') return <IconThumbsUp size={size} color={color} />;
  if (status === 'download') return <IconDownload size={size} color={color} />;
  if (status === 'reprint') return <IconClock size={size} color={color} />; // Fallback
  return <IconPool size={size} color={color} />;
}
