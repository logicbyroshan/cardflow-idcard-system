import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView, ActivityIndicator, TouchableWithoutFeedback, Dimensions } from 'react-native';
import { DynamicIcon } from './Icons';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, radius, shadows, gradients } from '../theme';
import { Wrap, HStack } from './Stack';
import { apiGet } from '../api/client';

const { width } = Dimensions.get('window');

/**
 * High-end side filter drawer matching the website's advanced search capabilities.
 */
export default function FilterDrawer({ visible, onClose, tableId, status, onApply, currentFilters = {} }) {

  const [loading, setLoading] = useState(false);
  const [classes, setClasses] = useState([]);
  const [sections, setSections] = useState([]);
  const [courses, setCourses] = useState([]);
  const [branches, setBranches] = useState([]);
  const [fields, setFields] = useState([]);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [classToSections, setClassToSections] = useState({});
  const [courseToBranches, setCourseToBranches] = useState({});
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
      const { ok, data } = await apiGet(`/api/mobile/table/${tableId}/filter-options/`, { status });

      if (ok && data?.success) {
        setFields(data.data?.fields || []);
        setClasses(data.data?.classes || []);
        setSections(data.data?.sections || []);
        setCourses(data.data?.courses || []);
        setBranches(data.data?.branches || []);
        setClassToSections(data.data?.class_to_sections || {});
        setCourseToBranches(data.data?.course_to_branches || {});
      }
    } catch (e) { console.log('Filter load err', e); }
    setLoading(false);
  };

  const toggleValue = (field, value) => {
    setTempFilters(prev => {
      const nextVal = prev[field] === value ? null : value;
      let nextFilters = { ...prev, [field]: nextVal };

      // Reset dynamic child values if parent value changes and is no longer compatible
      if (field === 'class') {
        const allowed = nextVal ? (classToSections[nextVal] || []) : sections;
        if (prev.section && !allowed.includes(prev.section)) {
          nextFilters.section = null;
        }
      }

      if (field === 'course') {
        const allowed = nextVal ? (courseToBranches[nextVal] || []) : branches;
        if (prev.branch && !allowed.includes(prev.branch)) {
          nextFilters.branch = null;
        }
      }

      return nextFilters;
    });
  };

  const clearAll = () => setTempFilters({});

  const apply = () => {
    onApply(tempFilters);
    onClose();
  };

  const allowedSections = tempFilters.class
    ? (classToSections[tempFilters.class] || [])
    : sections;

  const allowedBranches = tempFilters.course
    ? (courseToBranches[tempFilters.course] || [])
    : branches;

  const imageFields = fields.filter(f => {
    const t = (f.type || '').toLowerCase();
    const n = (f.name || '').toLowerCase();
    return t.includes('image') || t.includes('photo') || n.includes('photo') || (n.includes('sign') && !n.includes('designation')) || n.includes('pic');
  });

  const imageColumnOptions = imageFields.length > 0 ? imageFields.map(f => f.name) : ['photo'];

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
              <DynamicIcon name="times" size={16} color={colors.gray400} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={s.center}>
              <ActivityIndicator color={colors.brandPrimary} />
            </View>
          ) : (
            <ScrollView style={s.scroll} contentContainerStyle={s.scrollC} showsVerticalScrollIndicator={false}>
              {/* Advanced Sorting */}
              <View style={s.section}>
                <Text style={s.sectionTitle}>Advanced Sorting</Text>
                <Wrap spacing={8} style={s.chipRow}>
                  {[
                    { label: 'ID (Newest First)', val: 'sr-asc' },
                    { label: 'Name A to Z', val: 'name-asc' },
                    { label: 'Name Z to A', val: 'name-desc' },
                  ].map(opt => {
                    const isActive = tempFilters.sort === opt.val;
                    return (
                      <TouchableOpacity key={opt.val} onPress={() => toggleValue('sort', opt.val)} style={[s.chip, isActive && s.chipActive]}>
                        <Text style={[s.chipText, isActive && s.chipTextActive]}>{opt.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </Wrap>
              </View>

              {/* Image Column Selection */}
              <View style={s.section}>
                <Text style={s.sectionTitle}>Select Image Column</Text>
                <TouchableOpacity 
                  style={s.dropdownSelector} 
                  onPress={() => setShowColumnPicker(true)}
                >
                  <Text style={s.dropdownSelectorText}>
                    {tempFilters.image_column ? tempFilters.image_column.toUpperCase() : 'Default (PHOTO)'}
                  </Text>
                  <DynamicIcon name="chevron-down" size={12} color={colors.gray400} />
                </TouchableOpacity>
              </View>

              {/* Image Sort (Photo Filter) */}
              <View style={s.section}>
                <Text style={s.sectionTitle}>Image Sort</Text>
                <Wrap spacing={8} style={s.chipRow}>
                  {[
                    { label: 'Complete (Image Uploaded)', val: 'complete' },
                    { label: 'Pending (Placeholder Created)', val: 'pending' },
                    { label: 'Incomplete (No Placeholder)', val: 'incomplete' },
                  ].map(opt => {
                    const isActive = tempFilters.photo === opt.val;
                    return (
                      <TouchableOpacity key={opt.val} onPress={() => toggleValue('photo', opt.val)} style={[s.chip, isActive && s.chipActive]}>
                        <Text style={[s.chipText, isActive && s.chipTextActive]}>{opt.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </Wrap>
              </View>
              
              {/* Class Filter */}
              {classes.length > 0 && (
                <View style={s.section}>
                  <Text style={s.sectionTitle}>Class</Text>
                  <Wrap spacing={8} style={s.chipRow}>
                    {classes.map(cls => {
                      const isActive = tempFilters.class === cls;
                      return (
                        <TouchableOpacity key={cls} onPress={() => toggleValue('class', cls)} style={[s.chip, isActive && s.chipActive]}>
                          <Text style={[s.chipText, isActive && s.chipTextActive]}>{cls}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </Wrap>
                </View>
              )}

              {/* Section Filter */}
              {allowedSections.length > 0 && (
                <View style={s.section}>
                  <Text style={s.sectionTitle}>Section</Text>
                  <Wrap spacing={8} style={s.chipRow}>
                    {allowedSections.map(sec => {
                      const isActive = tempFilters.section === sec;
                      return (
                        <TouchableOpacity key={sec} onPress={() => toggleValue('section', sec)} style={[s.chip, isActive && s.chipActive]}>
                          <Text style={[s.chipText, isActive && s.chipTextActive]}>{sec}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </Wrap>
                </View>
              )}

              {/* Course Filter */}
              {courses.length > 0 && (
                <View style={s.section}>
                  <Text style={s.sectionTitle}>Course</Text>
                  <Wrap spacing={8} style={s.chipRow}>
                    {courses.map(crs => {
                      const isActive = tempFilters.course === crs;
                      return (
                        <TouchableOpacity key={crs} onPress={() => toggleValue('course', crs)} style={[s.chip, isActive && s.chipActive]}>
                          <Text style={[s.chipText, isActive && s.chipTextActive]}>{crs}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </Wrap>
                </View>
              )}

              {/* Branch Filter */}
              {allowedBranches.length > 0 && (
                <View style={s.section}>
                  <Text style={s.sectionTitle}>Branch</Text>
                  <Wrap spacing={8} style={s.chipRow}>
                    {allowedBranches.map(brn => {
                      const isActive = tempFilters.branch === brn;
                      return (
                        <TouchableOpacity key={brn} onPress={() => toggleValue('branch', brn)} style={[s.chip, isActive && s.chipActive]}>
                          <Text style={[s.chipText, isActive && s.chipTextActive]}>{brn}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </Wrap>
                </View>
              )}

              {classes.length === 0 && sections.length === 0 && courses.length === 0 && branches.length === 0 && !loading && (
                <Text style={s.emptyText}>No filter fields found on this table.</Text>
              )}
            </ScrollView>
          )}

          <HStack spacing={12} style={s.footer} align="center">
            <TouchableOpacity onPress={clearAll} style={s.clearBtn}>
              <Text style={s.clearText}>Reset</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={apply} style={s.applyBtnWrap}>
              <LinearGradient colors={gradients.brand} style={s.applyBtn}>
                <Text style={s.applyText}>Apply Filters</Text>
              </LinearGradient>
            </TouchableOpacity>
          </HStack>
        </View>
        {/* Photo Column Selector Overlay */}
        {showColumnPicker && (
          <View style={s.menuOverlayContainer}>
            <TouchableOpacity style={s.menuOverlay} activeOpacity={1} onPress={() => setShowColumnPicker(false)}>
              <View style={s.menuContent}>
                <Text style={s.menuTitle}>Select Image Column</Text>
                
                <TouchableOpacity 
                  style={[s.menuItem, !tempFilters.image_column && s.menuItemActive]} 
                  onPress={() => {
                    setTempFilters(prev => ({ ...prev, image_column: null }));
                    setShowColumnPicker(false);
                  }}
                >
                  <Text style={[s.menuItemText, !tempFilters.image_column && s.menuItemTextActive]}>Default (PHOTO)</Text>
                </TouchableOpacity>

                {imageColumnOptions.map(col => {
                  const isActive = tempFilters.image_column === col;
                  return (
                    <TouchableOpacity 
                      key={col} 
                      style={[s.menuItem, isActive && s.menuItemActive]} 
                      onPress={() => {
                        setTempFilters(prev => ({ ...prev, image_column: col }));
                        setShowColumnPicker(false);
                      }}
                    >
                      <Text style={[s.menuItemText, isActive && s.menuItemTextActive]}>{col.toUpperCase()}</Text>
                    </TouchableOpacity>
                  );
                })}

                <TouchableOpacity style={s.menuCancel} onPress={() => setShowColumnPicker(false)}>
                  <Text style={s.menuCancelText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </View>
        )}
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
  title: { fontSize: 18, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray800 },
  subtitle: { fontSize: 12, color: colors.gray400, marginTop: 2 },
  closeBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.gray50, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { flex: 1 },
  scrollC: { padding: 20 },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 11, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray400, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 12 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: { 
    paddingHorizontal: 12, 
    paddingVertical: 8, 
    borderRadius: radius.sm, 
    backgroundColor: colors.gray50, 
    borderWidth: 1, 
    borderColor: '#e2e8f0' 
  },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontSize: 12, fontFamily: 'SairaSemiCondensed-SemiBold', color: colors.gray600 },
  chipTextActive: { color: '#fff' },
  emptyText: { fontSize: 13, color: colors.gray400, textAlign: 'center', marginTop: 40 },
  footer: { 
    flexDirection: 'row', 
    padding: 20, 
    borderTopWidth: 1, 
    borderTopColor: '#f1f5f9',
    backgroundColor: '#fff' 
  },
  clearBtn: { flex: 1, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: colors.gray100 },
  clearText: { fontSize: 14, fontFamily: 'SairaSemiCondensed-SemiBold', color: colors.gray600 },
  applyBtnWrap: { flex: 2, borderRadius: radius.sm, overflow: 'hidden' },
  applyBtn: { paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  applyText: { fontSize: 14, fontFamily: 'SairaSemiCondensed-Bold', color: '#fff' },

  // Dropdown selector styles
  dropdownSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: radius.sm,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  dropdownSelectorText: {
    fontSize: 13,
    fontFamily: 'SairaSemiCondensed-SemiBold',
    color: colors.gray800,
  },
  menuOverlayContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1000,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  menuOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: 16,
  },
  menuContent: {
    backgroundColor: '#fff',
    borderRadius: radius.lg,
    padding: 8,
    ...shadows.xl,
  },
  menuTitle: {
    fontSize: 13,
    fontFamily: 'SairaSemiCondensed-Bold',
    color: colors.gray400,
    textTransform: 'uppercase',
    textAlign: 'center',
    paddingVertical: 12,
    letterSpacing: 1,
  },
  menuItem: {
    padding: 16,
    borderRadius: radius.md,
    backgroundColor: '#fff',
  },
  menuItemActive: {
    backgroundColor: '#eff6ff',
  },
  menuItemText: {
    fontSize: 15,
    fontFamily: 'SairaSemiCondensed-Bold',
    color: colors.gray800,
    textAlign: 'center',
  },
  menuItemTextActive: {
    color: colors.brandPrimary,
  },
  menuCancel: {
    marginTop: 8,
    paddingVertical: 16,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  menuCancelText: {
    fontSize: 15,
    fontFamily: 'SairaSemiCondensed-Bold',
    color: colors.gray400,
  },
});
