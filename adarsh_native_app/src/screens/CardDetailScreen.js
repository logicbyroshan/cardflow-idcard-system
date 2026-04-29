import React, { useState, useEffect } from 'react';
import { 
  View, Text, ScrollView, TouchableOpacity, Image, 
  StyleSheet, Alert, RefreshControl, ActivityIndicator 
} from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import TopBar from '../components/TopBar';
import Toast from '../components/Toast';
import StatusBadge from '../components/StatusBadge';
import { DetailSkeleton } from '../components/Skeleton';
import { apiGet, apiPost } from '../api/client';
import { colors, gradients, typography, spacing, radius, shadows, roleThemes } from '../theme';
import { useAuth } from '../context/AuthContext';

export default function CardDetailScreen({ navigation, route }) {
  const { cardId } = route.params;
  const { user } = useAuth();
  const theme = roleThemes[user?.role] || roleThemes.default;

  const [card, setCard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });
  const [error, setError] = useState(null);

  const showToast = (msg, type = 'info') => setToast({ visible: true, message: msg, type });

  const loadCard = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const { ok, data } = await apiGet(`/app/api/card/${cardId}/detail/`);
      if (ok && data?.success) {
        setCard(data.data);
      } else {
        setError(data?.message || 'Failed to load card details');
      }
    } catch (e) {
      setError('Network error - check your connection');
    }
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => { loadCard(); }, [cardId]);

  const updateStatus = async (status) => {
    setUpdating(true);
    try {
      const { data } = await apiPost(`/app/api/card/${cardId}/status/`, { status });
      showToast(data?.success ? 'Status updated!' : (data?.message || 'Failed'), data?.success ? 'success' : 'error');
      if (data?.success) loadCard(true);
    } catch (e) { showToast('Network error', 'error'); }
    setUpdating(false);
  };

  const deleteCard = () => {
    Alert.alert('Delete Card?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          const { data } = await apiPost(`/app/api/card/${cardId}/delete/`, {});
          if (data?.success) {
            showToast('Card deleted', 'success');
            setTimeout(() => navigation.goBack(), 800);
          } else showToast(data?.message || 'Delete failed', 'error');
        } catch (e) { showToast('Network error', 'error'); }
      }},
    ]);
  };

  if (loading) return (
    <View style={s.root}><TopBar title="Card Detail" onBack={() => navigation.goBack()} /><DetailSkeleton /></View>
  );

  if (!card) return (
    <View style={s.root}>
      <TopBar title="Card Detail" onBack={() => navigation.goBack()} />
      <View style={s.center}><Text style={s.errText}>{error || 'Card not found'}</Text></TouchableOpacity></View>
    </View>
  );

  const fd = card.field_data || {};
  const cardName = card.name || fd.NAME || fd.Name || fd.name || fd.FULL_NAME || fd.full_name || `Card #${card.id}`;
  const isLocked = ['pool'].includes(card.status) && (user?.role === 'client' || user?.role === 'client_staff');

  const STATUS_OPTIONS = [
    { key: 'pending', label: 'Pending' },
    { key: 'verified', label: 'Verified' },
    { key: 'approved', label: 'Approved' },
    { key: 'download', label: 'Download' },
    { key: 'pool', label: 'Pool' },
  ];

  return (
    <View style={s.root}>
      <TopBar title="Card Details" subtitle={cardName} onBack={() => navigation.goBack()} />
      
      <ScrollView 
        style={s.scroll} 
        contentContainerStyle={s.scrollC} 
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadCard(true)} tintColor={colors.brandLight} />}
      >
        <LinearGradient colors={['#fff', '#f8fafc']} style={s.heroCard}>
          <View style={s.heroTop}>
            <View style={s.photoFrame}>
              {card.photo_url ? (
                <Image source={{ uri: card.photo_url }} style={s.photo} />
              ) : (
                <View style={s.photoPlaceholder}><FontAwesome5 name="user" size={24} color={colors.gray200} solid /></View>
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
            <FontAwesome5 name="id-card" size={12} color={colors.gray400} />
            <Text style={s.sectionTitle}>FIELD DATA</Text>
          </View>
          <View style={s.fieldsList}>
            {Object.entries(fd).map(([key, val], i) => (
              <View key={key} style={[s.fieldRow, i === 0 && { borderTopWidth: 0 }]}>
                <Text style={s.fieldKey}>{key.replace(/_/g, ' ')}</Text>
                <Text style={s.fieldVal}>{val || '-'}</Text>
              </View>
            ))}
            {Object.keys(fd).length === 0 && (
              <View style={s.emptyFields}><Text style={s.emptyFieldsText}>No field data available</Text></View>
            )}
          </View>
        </View>

        <View style={s.actions}>
          {!isLocked && (
            <TouchableOpacity onPress={() => navigation.navigate('CardForm', { tableId: card.table_id, cardId: card.id })} activeOpacity={0.85} style={s.editBtnWrap}>
              <LinearGradient colors={theme.gradient} start={{x:0, y:0}} end={{x:1, y:0}} style={s.editBtn}>
                <FontAwesome5 name="pen" size={12} color="#fff" />
                <Text style={s.editBtnText}>Edit Information</Text>
              </LinearGradient>
            </TouchableOpacity>
          )}

          {isLocked && (
            <View style={s.lockedNote}>
              <FontAwesome5 name="lock" size={12} color={colors.gray400} />
              <Text style={s.lockedNoteText}>Card is locked (Status: {card.status})</Text>
            </View>
          )}

          <View style={s.statusGrid}>
            {STATUS_OPTIONS.map(opt => (
              <TouchableOpacity 
                key={opt.key} 
                onPress={() => updateStatus(opt.key)} 
                disabled={updating} 
                style={s.statusOption}
              >
                <StatusBadge status={opt.key} variant={card.status === opt.key ? 'solid' : 'glass'} />
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity onPress={deleteCard} style={s.deleteBtn}>
            <FontAwesome5 name="trash-alt" size={12} color="#ef4444" />
            <Text style={s.deleteBtnText}>Delete Card</Text>
          </TouchableOpacity>
        </View>

        <View style={s.timestampRow}>
          <Text style={s.tsText}>Updated: {card.updated_at || '-'}</Text>
        </View>
      </ScrollView>
      <Toast visible={toast.visible} message={toast.message} type={toast.type} onHide={() => setToast(p => ({...p, visible: false}))} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceBg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  scroll: { flex: 1 }, scrollC: { padding: 16, paddingBottom: 40 },
  heroCard: { backgroundColor: '#fff', borderRadius: 24, padding: 20, borderWidth: 1, borderColor: '#f1f5f9', ...shadows.md, marginBottom: 20 },
  heroTop: { flexDirection: 'row', gap: 20 },
  photoFrame: { width: 90, height: 110, borderRadius: 16, overflow: 'hidden', backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', ...shadows.sm },
  photo: { width: '100%', height: '100%' },
  photoPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  heroInfo: { flex: 1, justifyContent: 'center' },
  cardName: { fontSize: 20, fontWeight: '800', color: colors.gray800 },
  tableName: { fontSize: 13, color: colors.gray500, marginTop: 4 },
  statusLine: { flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 12 },
  vLine: { width: 1, height: 16, backgroundColor: '#e2e8f0' },
  srNo: { fontSize: 11, fontWeight: '700', color: colors.gray400 },
  section: { backgroundColor: '#fff', borderRadius: 24, padding: 4, borderWidth: 1, borderColor: '#f1f5f9', ...shadows.sm, marginBottom: 20 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16, paddingBottom: 8 },
  sectionTitle: { fontSize: 10, fontWeight: '800', color: colors.gray400, letterSpacing: 1.2 },
  fieldsList: { padding: 8 },
  fieldRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 8, borderTopWidth: 1, borderTopColor: '#f8fafc' },
  fieldKey: { fontSize: 11, fontWeight: '700', color: colors.gray400, textTransform: 'uppercase' },
  fieldVal: { fontSize: 13, fontWeight: '600', color: colors.gray700, flex: 1, textAlign: 'right', marginLeft: 20 },
  emptyFields: { padding: 20, alignItems: 'center' },
  emptyFieldsText: { fontSize: 12, color: colors.gray400, fontStyle: 'italic' },
  actions: { gap: 12 },
  editBtnWrap: { borderRadius: 16, overflow: 'hidden', ...shadows.md },
  editBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 16 },
  editBtnText: { fontSize: 14, fontWeight: '800', color: '#fff' },
  lockedNote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 16, backgroundColor: colors.gray100, borderRadius: 16 },
  lockedNoteText: { fontSize: 12, color: colors.gray500, fontWeight: '600' },
  statusGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 8 },
  statusOption: { minWidth: '30%' },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, marginTop: 10 },
  deleteBtnText: { fontSize: 12, color: '#ef4444', fontWeight: '600' },
  timestampRow: { marginTop: 24, alignItems: 'center' },
  tsText: { fontSize: 10, color: colors.gray400 },
  errText: { fontSize: 14, color: colors.error, textAlign: 'center' },
});
