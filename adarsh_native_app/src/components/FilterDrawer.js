import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView, TextInput, ActivityIndicator, TouchableWithoutFeedback, Dimensions } from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, radius, shadows, fontFamily, gradients } from '../theme';
import { apiGet } from '../api/client';

const { width } = Dimensions.get('window');

/**
 * High-end side filter drawer matching the website's advanced search capabilities.
 */
export default function FilterDrawer({ visible, onClose, tableId, onApply, currentFilters = {} }) {
  const [loading, setLoading] = useState(false);
  const [filterOptions, setFilterOptions] = useState([]);
  const [tempFilters, setTempFilters] = useState(currentFilters);

  useEffect(() => {
    if (visible) {
      loadFilterOptions();
      setTempFilters(currentFilters);
    }
  }, [visible]);

  const loadFilterOptions = async () => {
    setLoading(true);
    try {
      // The endpoint returns list of fields and their unique values for filtering
      const { ok, data } = await apiGet(`/app/api/table/${tableId}/filter-options/`);
      if (ok && data?.success) {
        setFilterOptions(data.data?.fields || []);
      }
    } catch (e) { console.log('Filter load err', e); }
    setLoading(false);
  };

  const toggleValue = (field, value) => {
    setTempFilters(prev => {
      // Special handling for single-select fields
      if (field === 'sort' || field === 'photo') {
        return { ...prev, [field]: prev[field] === value ? null : value };
      }

      const existing = prev[field] || [];
      const next = existing.includes(value) 
        ? existing.filter(v => v !== value) 
        : [...existing, value];
      return { ...prev, [field]: next };
    });
  };

  const clearAll = () => setTempFilters({});

  const apply = () => {
    onApply(tempFilters);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={s.overlay}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={s.backdrop} />
        </TouchableWithoutFeedback>
        
        <View style={s.drawer}>
          <View style={s.header}>
            <View>
              <Text style={s.title}>Advanced Filters</Text>
              <Text style={s.subtitle}>Refine your card results</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={s.closeBtn}>
              <FontAwesome5 name="times" size={16} color={colors.gray400} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={s.center}>
              <ActivityIndicator color={colors.brandPrimary} />
            </View>
          ) : (
            <ScrollView style={s.scroll} contentContainerStyle={s.scrollC} showsVerticalScrollIndicator={false}>
              {/* Static Filters: Sort & Photo */}
              <View style={s.section}>
                <Text style={s.sectionTitle}>Sort Order</Text>
                <View style={s.chipRow}>
                  {[
                    { label: 'A to Z', val: 'name-asc' },
                    { label: 'Z to A', val: 'name-desc' },
                    { label: 'Serial ASC', val: 'sr-asc' },
                  ].map(opt => {
                    const isActive = tempFilters.sort === opt.val;
                    return (
                      <TouchableOpacity key={opt.val} onPress={() => toggleValue('sort', opt.val)} style={[s.chip, isActive && s.chipActive]}>
                        <Text style={[s.chipText, isActive && s.chipTextActive]}>{opt.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={s.section}>
                <Text style={s.sectionTitle}>Photo Condition</Text>
                <View style={s.chipRow}>
                  {[
                    { label: 'Photo Present', val: 'with' },
                    { label: 'Photo Missing', val: 'without' },
                  ].map(opt => {
                    const isActive = tempFilters.photo === opt.val;
                    return (
                      <TouchableOpacity key={opt.val} onPress={() => toggleValue('photo', opt.val)} style={[s.chip, isActive && s.chipActive]}>
                        <Text style={[s.chipText, isActive && s.chipTextActive]}>{opt.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {filterOptions.length === 0 && !loading && (
                <Text style={s.emptyText}>No dynamic fields found.</Text>
              )}
              
              {filterOptions.map((f, i) => (
                <View key={f.name + i} style={s.section}>
                  <Text style={s.sectionTitle}>{f.name}</Text>
                  <View style={s.chipRow}>
                    {(f.options || []).map(opt => {
                      const isActive = (tempFilters[f.name] || []).includes(opt);
                      return (
                        <TouchableOpacity 
                          key={opt} 
                          onPress={() => toggleValue(f.name, opt)}
                          style={[s.chip, isActive && s.chipActive]}
                        >
                          <Text style={[s.chipText, isActive && s.chipTextActive]}>{opt}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ))}
            </ScrollView>
          )}

          <View style={s.footer}>
            <TouchableOpacity onPress={clearAll} style={s.clearBtn}>
              <Text style={s.clearText}>Reset</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={apply} style={s.applyBtnWrap}>
              <LinearGradient colors={gradients.brand} style={s.applyBtn}>
                <Text style={s.applyText}>Apply Filters</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15, 23, 42, 0.4)' },
  drawer: { 
    width: width * 0.8, 
    height: '100%', 
    backgroundColor: '#fff', 
    ...shadows.xl,
    paddingTop: 40, // Assuming safe area or manual padding
  },
  header: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between', 
    paddingHorizontal: 20, 
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9'
  },
  title: { fontSize: 18, fontFamily: fontFamily.bold, color: colors.gray800 },
  subtitle: { fontSize: 12, color: colors.gray400, marginTop: 2 },
  closeBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.gray50, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { flex: 1 },
  scrollC: { padding: 20 },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 11, fontWeight: '900', color: colors.gray400, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 12 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { 
    paddingHorizontal: 12, 
    paddingVertical: 8, 
    borderRadius: radius.sm, 
    backgroundColor: colors.gray50, 
    borderWidth: 1, 
    borderColor: '#e2e8f0' 
  },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontSize: 12, fontWeight: '600', color: colors.gray600 },
  chipTextActive: { color: '#fff' },
  emptyText: { fontSize: 13, color: colors.gray400, textAlign: 'center', marginTop: 40 },
  footer: { 
    flexDirection: 'row', 
    padding: 20, 
    gap: 12, 
    borderTopWidth: 1, 
    borderTopColor: '#f1f5f9',
    backgroundColor: '#fff' 
  },
  clearBtn: { flex: 1, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: colors.gray100 },
  clearText: { fontSize: 14, fontFamily: fontFamily.semibold, color: colors.gray600 },
  applyBtnWrap: { flex: 2, borderRadius: radius.sm, overflow: 'hidden' },
  applyBtn: { paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  applyText: { fontSize: 14, fontFamily: fontFamily.bold, color: '#fff' },
});
