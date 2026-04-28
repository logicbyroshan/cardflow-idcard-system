import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Image, StyleSheet, Alert } from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import TopBar from '../components/TopBar';
import Toast from '../components/Toast';
import StatusBadge from '../components/StatusBadge';
import { DetailSkeleton } from '../components/Skeleton';
import { apiGet, apiPost } from '../api/client';
import { colors, gradients, typography, spacing, radius, shadows } from '../theme';

export default function CardDetailScreen({ navigation, route }) {
  const { cardId } = route.params;
  const [card, setCard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAllFields, setShowAllFields] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });

  const showToast = (msg, type = 'info') => setToast({ visible: true, message: msg, type });

  useEffect(() => {
    (async () => {
      try {
        const { data } = await apiGet(`/app/api/card/${cardId}/detail/`);
        if (data?.success) setCard(data.data);
        else showToast(data?.message || 'Card not found', 'error');
      } catch (e) { showToast('Network error', 'error'); }
      setLoading(false);
    })();
  }, [cardId]);

  const setStatus = async (status) => {
    setShowStatusModal(false);
    try {
      const { data } = await apiPost(`/app/api/card/${cardId}/status/`, { status });
      showToast(data?.success ? (data.message || 'Status updated!') : (data?.message || 'Failed'), data?.success ? 'success' : 'error');
      if (data?.success) {
        setCard(prev => prev ? { ...prev, status, status_display: status.charAt(0).toUpperCase() + status.slice(1) } : prev);
      }
    } catch (e) { showToast('Network error', 'error'); }
  };

  const deleteCard = () => {
    Alert.alert('Delete Card?', 'Are you sure you want to delete this card?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          const { data } = await apiPost(`/app/api/card/${cardId}/delete/`, {});
          showToast(data?.success ? 'Card deleted' : (data?.message || 'Delete failed'), data?.success ? 'success' : 'error');
          if (data?.success) setTimeout(() => navigation.goBack(), 800);
        } catch (e) { showToast('Network error', 'error'); }
      }},
    ]);
  };

  if (loading) return (
    <View style={s.root}><TopBar title="Card Detail" onBack={() => navigation.goBack()} /><DetailSkeleton /></View>
  );

  if (!card) return (
    <View style={s.root}><TopBar title="Card Detail" onBack={() => navigation.goBack()} /><View style={s.loadWrap}><Text style={s.errText}>Card not found</Text></View></View>
  );

  const fd = card.field_data || {};
  const fieldEntries = Object.entries(fd).filter(([_, v]) => v !== null && v !== '');

  return (
    <View style={s.root}>
      {/* Header with status badge */}
      <TopBar 
        title={card.name || 'Card Detail'} 
        subtitle={`${card.table_name || ''} - ${card.group_name || ''}`} 
        onBack={() => navigation.goBack()} 
        rightAction={{ icon: 'pen', onPress: () => navigation.navigate('CardForm', { tableId: card.table_id, cardId: card.id }) }}
      />

      <ScrollView style={s.scroll} contentContainerStyle={s.scrollC} showsVerticalScrollIndicator={false}>
        {/* Hero Card */}
        <View style={s.heroCard}>
          <LinearGradient colors={gradients.brand} style={s.heroStrip} />
          <View style={s.heroInner}>
            {card.photo_url ? (
              <Image source={{ uri: card.photo_url }} style={s.heroPhoto} />
            ) : (
              <View style={[s.heroPhoto, s.heroPhotoPlaceholder]}><FontAwesome5 name="user" size={28} color={colors.indigo200} solid /></View>
            )}
            <View style={s.heroInfo}>
              <Text style={s.heroName}>{card.name}</Text>
              {!!card.class_designation && (
                <View style={s.classBadge}><FontAwesome5 name="graduation-cap" size={8} color="#4f46e5" /><Text style={s.classText}>{card.class_designation}</Text></View>
              )}
              <View style={s.heroMeta}>
                {!!card.id_number && <MetaItem icon="id-badge" color="#818cf8" text={card.id_number} />}
                {!!card.contact && <MetaItem icon="phone" color="#34d399" text={card.contact} />}
                {!!card.dob && <MetaItem icon="calendar" color="#fbbf24" text={card.dob} />}
              </View>
            </View>
          </View>
          <View style={s.statusRow}>
            <StatusBadge status={card.status} size="lg" />
          </View>
        </View>

        {/* Family */}
        {(card.father_name || card.mother_name) && (
          <>
            <Text style={s.secTitle}>FAMILY</Text>
            <View style={s.familyGrid}>
              {!!card.father_name && <InfoCard icon="user-tie" color="#3b82f6" bg="#dbeafe" borderColor="#bfdbfe" label="Father" value={card.father_name} />}
              {!!card.mother_name && <InfoCard icon="user" color="#ec4899" bg="#fce7f3" borderColor="#fbcfe8" label="Mother" value={card.mother_name} />}
            </View>
          </>
        )}

        {/* Details */}
        {(card.blood_group || card.session || card.address) && (
          <>
            <Text style={s.secTitle}>DETAILS</Text>
            <View style={s.familyGrid}>
              {!!card.blood_group && <InfoCard icon="tint" color="#ef4444" bg="#fef2f2" borderColor="#fecaca" label="Blood Group" value={card.blood_group} valueLarge />}
              {!!card.session && <InfoCard icon="calendar-alt" color="#8b5cf6" bg="#ede9fe" borderColor="#ddd6fe" label="Session" value={card.session} />}
            </View>
            {!!card.address && (
              <View style={[s.infoCard, { marginHorizontal: 16, marginTop: 10, borderColor: '#fed7aa' }]}>
                <View style={s.infoHeader}><View style={[s.infoIcon, { backgroundColor: '#fff7ed' }]}><FontAwesome5 name="map-marker-alt" size={10} color="#f97316" solid /></View><Text style={s.infoLabel}>ADDRESS</Text></View>
                <Text style={s.infoValue}>{card.address}</Text>
              </View>
            )}
          </>
        )}

        {/* All Fields Collapsible */}
        {fieldEntries.length > 0 && (
          <View style={s.fieldsCard}>
            <TouchableOpacity onPress={() => setShowAllFields(!showAllFields)} style={s.fieldsHeader} activeOpacity={0.7}>
              <View style={s.fieldsHeaderLeft}><View style={[s.infoIcon, { backgroundColor: colors.indigo50 }]}><FontAwesome5 name="list-ul" size={10} color={colors.brandLight} solid /></View><Text style={s.fieldsHeaderText}>All Fields</Text></View>
              <FontAwesome5 name={showAllFields ? 'chevron-up' : 'chevron-down'} size={10} color={colors.gray400} />
            </TouchableOpacity>
            {showAllFields && (
              <View style={s.fieldsBody}>
                {fieldEntries.map(([key, value]) => (
                  <View key={key} style={s.fieldRow}>
                    <Text style={s.fieldKey} numberOfLines={1}>{key}</Text>
                    <Text style={s.fieldValue} numberOfLines={1}>{String(value)}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Timestamps */}
        <View style={s.timestampCard}>
          <View style={s.tsRow}><View style={s.tsLabel}><FontAwesome5 name="calendar-plus" size={10} color={colors.gray400} /><Text style={s.tsLabelText}>Created</Text></View><Text style={s.tsValue}>{card.created_at || '-'}</Text></View>
          <View style={s.tsRow}><View style={s.tsLabel}><FontAwesome5 name="calendar-check" size={10} color={colors.gray400} /><Text style={s.tsLabelText}>Updated</Text></View><Text style={s.tsValue}>{card.updated_at || '-'}</Text></View>
        </View>

        {/* Actions */}
        <View style={s.actions}>
          <TouchableOpacity onPress={() => setShowStatusModal(true)} activeOpacity={0.85} style={s.primaryBtnWrap}>
            <LinearGradient colors={gradients.brand} style={s.primaryBtn}>
              <FontAwesome5 name="sync-alt" size={13} color="#fff" /><Text style={s.primaryBtnText}>Change Status</Text>
            </LinearGradient>
          </TouchableOpacity>
          <TouchableOpacity onPress={deleteCard} style={s.deleteBtn} activeOpacity={0.7}>
            <FontAwesome5 name="trash-alt" size={13} color="#ef4444" solid /><Text style={s.deleteBtnText}>Delete Card</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Status Modal */}
      {showStatusModal && (
        <View style={s.modalOverlay}>
          <TouchableOpacity style={s.modalBg} activeOpacity={1} onPress={() => setShowStatusModal(false)} />
          <View style={s.modalSheet}>
            <View style={s.modalHandle} />
            <Text style={s.modalTitle}><FontAwesome5 name="sync-alt" size={10} color={colors.brandLight} />  Change Status</Text>
            <View style={s.statusGrid}>
              {[['pending','Pending','clock','#fef3c7','#b45309','#fde68a'],['verified','Verified','check-circle','#d1fae5','#047857','#a7f3d0'],['approved','Approved','check-double','#e0f2fe','#0369a1','#bae6fd'],['download','Download','download','#ede9fe','#7c3aed','#ddd6fe']].map(([st,label,icon,bg,tc,bc]) => (
                <TouchableOpacity key={st} onPress={() => setStatus(st)} style={[s.statusBtn, { backgroundColor: bg, borderColor: bc }]} activeOpacity={0.7}>
                  <FontAwesome5 name={icon} size={12} color={tc} solid /><Text style={[s.statusBtnText, { color: tc }]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity onPress={() => setShowStatusModal(false)} style={s.cancelBtn}><Text style={s.cancelBtnText}>Cancel</Text></TouchableOpacity>
          </View>
        </View>
      )}

      <Toast visible={toast.visible} message={toast.message} type={toast.type} onHide={() => setToast(p => ({ ...p, visible: false }))} />
    </View>
  );
}

function MetaItem({ icon, color, text }) {
  return (<View style={s.metaItem}><FontAwesome5 name={icon} size={9} color={color} solid /><Text style={s.metaText}>{text}</Text></View>);
}

function InfoCard({ icon, color, bg, borderColor, label, value, valueLarge }) {
  return (
    <View style={[s.infoCard, { borderColor }]}>
      <View style={s.infoHeader}><View style={[s.infoIcon, { backgroundColor: bg }]}><FontAwesome5 name={icon} size={10} color={color} solid /></View><Text style={s.infoLabel}>{label.toUpperCase()}</Text></View>
      <Text style={[s.infoValue, valueLarge && { fontSize: 14, fontWeight: '700', color }]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceBg },
  loadWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errText: { fontSize: 14, color: colors.gray500 },
  scroll: { flex: 1 }, scrollC: { paddingBottom: 40 },
  // Hero
  heroCard: { marginHorizontal: 16, marginTop: 16, backgroundColor: '#fff', borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: colors.indigo100, ...shadows.sm },
  heroStrip: { height: 6 },
  heroInner: { flexDirection: 'row', alignItems: 'flex-start', gap: 16, padding: 16 },
  heroPhoto: { width: 80, height: 100, borderRadius: 12, borderWidth: 2, borderColor: colors.indigo100 },
  heroPhotoPlaceholder: { backgroundColor: colors.indigo50, alignItems: 'center', justifyContent: 'center' },
  heroInfo: { flex: 1, paddingTop: 4 },
  heroName: { fontSize: 17, fontWeight: '700', color: colors.gray800, marginBottom: 4 },
  classBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.indigo50, borderWidth: 1, borderColor: colors.indigo100, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' },
  classText: { fontSize: 11, fontWeight: '600', color: '#4f46e5' },
  heroMeta: { marginTop: 10, gap: 6 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontSize: 11, fontWeight: '500', color: colors.gray500 },
  statusRow: { paddingHorizontal: 16, paddingBottom: 12 },
  // Sections
  secTitle: { fontSize: 10, fontWeight: '700', color: colors.gray400, letterSpacing: 1.2, marginHorizontal: 20, marginTop: 16, marginBottom: 8 },
  familyGrid: { flexDirection: 'row', gap: 10, marginHorizontal: 16 },
  infoCard: { flex: 1, backgroundColor: '#fff', borderRadius: 20, padding: 14, borderWidth: 1, ...shadows.sm },
  infoHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  infoIcon: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  infoLabel: { fontSize: 9, fontWeight: '700', color: colors.gray400, letterSpacing: 0.8 },
  infoValue: { fontSize: 12, fontWeight: '600', color: colors.gray800 },
  // Fields
  fieldsCard: { marginHorizontal: 16, marginTop: 12, backgroundColor: '#fff', borderRadius: 20, borderWidth: 1, borderColor: colors.indigo100, overflow: 'hidden', ...shadows.sm },
  fieldsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 },
  fieldsHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fieldsHeaderText: { fontSize: 13, fontWeight: '700', color: colors.gray700 },
  fieldsBody: { borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  fieldRow: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f9fafb' },
  fieldKey: { flex: 0.42, fontSize: 11, fontWeight: '600', color: colors.gray400, textTransform: 'uppercase' },
  fieldValue: { flex: 0.58, fontSize: 11, fontWeight: '600', color: colors.gray700, textAlign: 'right' },
  // Timestamps
  timestampCard: { marginHorizontal: 16, marginTop: 12, backgroundColor: '#fff', borderRadius: 20, padding: 14, borderWidth: 1, borderColor: '#f1f5f9', ...shadows.sm },
  tsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  tsLabel: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tsLabelText: { fontSize: 11, color: colors.gray400 },
  tsValue: { fontSize: 11, fontWeight: '600', color: colors.gray600 },
  // Actions
  actions: { marginHorizontal: 16, marginTop: 16, gap: 10 },
  primaryBtnWrap: { borderRadius: 20, overflow: 'hidden', ...shadows.md },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 20 },
  primaryBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca', borderRadius: 20 },
  deleteBtnText: { fontSize: 14, fontWeight: '700', color: '#ef4444' },
  // Modal
  modalOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 70 },
  modalBg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)' },
  modalSheet: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 20, ...shadows.xl },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#e5e7eb', alignSelf: 'center', marginTop: 12, marginBottom: 8 },
  modalTitle: { fontSize: 14, fontWeight: '700', color: colors.gray800, paddingHorizontal: 16, marginBottom: 16 },
  statusGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 16 },
  statusBtn: { width: '47%', paddingVertical: 14, borderRadius: 20, borderWidth: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  statusBtnText: { fontSize: 12, fontWeight: '700' },
  cancelBtn: { marginTop: 12, marginHorizontal: 16, paddingVertical: 12, backgroundColor: colors.gray100, borderRadius: 20, alignItems: 'center' },
  cancelBtnText: { fontSize: 12, fontWeight: '700', color: colors.gray500 },
});
