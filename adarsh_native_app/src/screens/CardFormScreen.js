import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import TopBar from '../components/TopBar';
import Toast from '../components/Toast';
import { ListSkeleton } from '../components/Skeleton';
import { ErrorBanner } from '../components/NetworkGuard';
import { apiGet, apiPostForm } from '../api/client';
import { colors, gradients, shadows, radius, roleThemes } from '../theme';
import { useAuth } from '../context/AuthContext';
import useRefreshableResource from '../hooks/useRefreshableResource';

export default function CardFormScreen({ navigation, route }) {
  const { tableId, cardId } = route?.params || {};
  const isEdit = !!cardId;
  const [fields, setFields] = useState([]);
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);
  const [tableName, setTableName] = useState('');
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });
  const { user } = useAuth();
  const theme = roleThemes[user?.role] || roleThemes.default;
  const showToast = (msg, type = 'info') => setToast({ visible: true, message: msg, type });

  const loadData = useCallback(async () => {
    try {
      // Load table fields
      const { ok: fOk, data: fData } = await apiGet(`/api/mobile/table/${tableId}/filter-options/?status=pending`);
      if (fOk && fData?.success && fData.data?.fields) {
        setFields(fData.data.fields);
      }

      // If editing, load existing card data
      if (isEdit) {
        const { ok: cOk, data: cData } = await apiGet(`/api/mobile/card/${cardId}/detail/`);
        if (cOk && cData?.success) {
          setValues(cData.data?.field_data || {});
          setTableName(cData.data?.table_name || '');
        } else if (!cOk) {
          throw new Error('Failed to load card details');
        }
      }
    } catch (e) {
      throw new Error('Network error - check your connection');
    }
  }, [tableId, cardId, isEdit]);

  const { loading, error, refresh } = useRefreshableResource(loadData);

  const handleSave = async () => {
    setSaving(true);
    try {
      const formData = new FormData();
      formData.append('field_data', JSON.stringify(values));

      const url = isEdit
        ? `/api/mobile/table/${tableId}/card/${cardId}/update/`
        : `/api/mobile/table/${tableId}/card/add/`;

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
      {error && <ErrorBanner message={error} onDismiss={() => {}} onRetry={refresh} />}
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
            <LinearGradient colors={theme.gradient} start={{x:0, y:0}} end={{x:1, y:0}} style={s.saveBtn}>
              {saving && <ActivityIndicator size="small" color="#fff" style={{ marginRight: 8 }} />}
              <Text style={s.saveBtnText}>{isEdit ? 'Update Card Data' : 'Save New Card'}</Text>
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
  noFieldsCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#eff6ff', borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: '#dbeafe', marginBottom: 20 },
  noFieldsText: { flex: 1, fontSize: 13, color: '#1e40af', lineHeight: 18 },
  field: { marginBottom: 16 },
  fieldLabelRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, paddingLeft: 4 },
  fieldLabel: { fontSize: 11, fontWeight: '800', color: colors.gray400, letterSpacing: 1.2, textTransform: 'uppercase' },
  mandatoryDot: { width: 5, height: 5, borderRadius: radius.full, backgroundColor: '#f43f5e' },
  fieldInput: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#f1f5f9', borderRadius: radius.md, paddingHorizontal: 16, paddingVertical: 14, fontSize: 14, color: colors.gray800, fontWeight: '600', ...shadows.sm },
  bottomActions: { marginTop: 12 },
  saveBtnWrap: { borderRadius: radius.md, overflow: 'hidden', ...shadows.lg },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 18 },
  saveBtnText: { fontSize: 15, fontWeight: '900', color: '#fff', letterSpacing: 0.5 },
  cancelBtn: { paddingVertical: 16, backgroundColor: '#fff', borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: '#e2e8f0' },
  cancelBtnText: { fontSize: 14, fontWeight: '700', color: colors.gray500 },
});
