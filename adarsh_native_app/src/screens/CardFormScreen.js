import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import TopBar from '../components/TopBar';
import Toast from '../components/Toast';
import { apiGet, apiPostForm } from '../api/client';
import { ListSkeleton } from '../components/Skeleton';
import { colors, gradients, shadows } from '../theme';

export default function CardFormScreen({ navigation, route }) {
  const { tableId, cardId } = route.params;
  const isEdit = !!cardId;
  const [fields, setFields] = useState([]);
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tableName, setTableName] = useState('');
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });
  const showToast = (msg, type = 'info') => setToast({ visible: true, message: msg, type });

  useEffect(() => {
    (async () => {
      try {
        // Load table fields
        const { data: fData } = await apiGet(`/app/api/table/${tableId}/filter-options/?status=pending`);
        if (fData?.success && fData.data?.fields) setFields(fData.data.fields);

        // If editing, load existing card data
        if (isEdit) {
          const { data: cData } = await apiGet(`/app/api/card/${cardId}/detail/`);
          if (cData?.success) {
            setValues(cData.data?.field_data || {});
            setTableName(cData.data?.table_name || '');
          }
        }
      } catch (e) { /* silent */ }
      setLoading(false);
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const formData = new FormData();
      formData.append('field_data', JSON.stringify(values));

      const url = isEdit
        ? `/app/api/table/${tableId}/card/${cardId}/update/`
        : `/app/api/table/${tableId}/card/add/`;

      const { data } = await apiPostForm(url, formData);
      showToast(
        data?.success ? (data.message || 'Saved!') : (data?.message || 'Failed'),
        data?.success ? 'success' : 'error'
      );
      if (data?.success) setTimeout(() => navigation.goBack(), 800);
    } catch (e) { showToast('Network error', 'error'); }
    setSaving(false);
  };

  if (loading) return (
    <View style={s.root}><TopBar title={isEdit ? 'Edit Card' : 'Add Card'} onBack={() => navigation.goBack()} /><ListSkeleton rows={6} /></View>
  );

  // Build field list — if we got field definitions from API, use those; otherwise use keys from existing data
  const fieldList = fields.length > 0
    ? fields.map(f => ({ name: f.name, type: f.type || 'text', mandatory: f.mandatory }))
    : Object.keys(values).filter(k => typeof values[k] === 'string').map(k => ({ name: k, type: 'text', mandatory: false }));

  return (
    <View style={s.root}>
      <TopBar title={isEdit ? 'Edit Card' : 'Add New Card'} subtitle={tableName || `Table #${tableId}`} onBack={() => navigation.goBack()} />
      <ScrollView style={s.scroll} contentContainerStyle={s.scrollC} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

        {fieldList.length === 0 && (
          <View style={s.noFieldsCard}>
            <FontAwesome5 name="info-circle" size={14} color={colors.info} />
            <Text style={s.noFieldsText}>No field definitions found for this table. Define fields in the desktop panel first.</Text>
          </View>
        )}

        {fieldList.map((field, i) => {
          const isImage = (field.type || '').toLowerCase().includes('image') || (field.type || '').toLowerCase().includes('photo');
          if (isImage) return null; // Skip image fields (handled separately via camera)

          return (
            <View key={field.name + i} style={s.field}>
              <View style={s.fieldLabelRow}>
                <Text style={s.fieldLabel}>{field.name}</Text>
                {field.mandatory && <View style={s.mandatoryDot} />}
              </View>
              <TextInput
                style={s.fieldInput}
                value={values[field.name] || ''}
                onChangeText={t => setValues(prev => ({ ...prev, [field.name]: t }))}
                placeholder={`Enter ${field.name.toLowerCase()}`}
                placeholderTextColor={colors.gray300}
                multiline={(field.type || '').toLowerCase().includes('textarea')}
                numberOfLines={(field.type || '').toLowerCase().includes('textarea') ? 3 : 1}
                keyboardType={
                  (field.type || '').toLowerCase().includes('number') || (field.type || '').toLowerCase().includes('mobile') ? 'numeric' :
                  (field.type || '').toLowerCase().includes('email') ? 'email-address' : 'default'
                }
              />
            </View>
          );
        })}

        {/* Save Button */}
        <View style={s.bottomActions}>
          <TouchableOpacity onPress={handleSave} disabled={saving} activeOpacity={0.85} style={s.saveBtnWrap}>
            <LinearGradient colors={gradients.brand} style={s.saveBtn}>
              {saving && <ActivityIndicator size="small" color="#fff" />}
              <Text style={s.saveBtnText}>{isEdit ? 'Update Card' : 'Add Card'}</Text>
            </LinearGradient>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.cancelBtn}>
            <Text style={s.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
      <Toast visible={toast.visible} message={toast.message} type={toast.type} onHide={() => setToast(p => ({ ...p, visible: false }))} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceBg },
  loadWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { flex: 1 }, scrollC: { padding: 16, paddingBottom: 40 },
  noFieldsCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#eff6ff', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: '#dbeafe', marginBottom: 16 },
  noFieldsText: { flex: 1, fontSize: 12, color: '#1d4ed8' },
  field: { marginBottom: 14 },
  fieldLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: colors.gray500, letterSpacing: 0.8, textTransform: 'uppercase' },
  mandatoryDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#ef4444' },
  fieldInput: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: colors.gray700, ...shadows.sm },
  bottomActions: { marginTop: 8, gap: 10 },
  saveBtnWrap: { borderRadius: 20, overflow: 'hidden', ...shadows.md },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16, borderRadius: 20 },
  saveBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  cancelBtn: { paddingVertical: 14, backgroundColor: colors.gray100, borderRadius: 20, alignItems: 'center' },
  cancelBtnText: { fontSize: 14, fontWeight: '600', color: colors.gray600 },
});
