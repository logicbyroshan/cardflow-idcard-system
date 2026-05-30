import React, { useState, useEffect, useRef } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform, TouchableWithoutFeedback, Image, Animated, Dimensions, BackHandler, Alert, Linking } from 'react-native';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DynamicIcon } from './Icons';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { apiGet, apiPostForm, BASE_URL, getSessionCookies, resolveAdarshImageUrl } from '../api/client';

const resolveImageSource = (val) => {
  const resolved = resolveAdarshImageUrl(val);
  if (!resolved) return null;
  if (resolved.startsWith('file://') || resolved.startsWith('content://') || resolved.startsWith('data:image')) {
    return { uri: resolved };
  }
  return {
    uri: resolved,
    headers: {
      Cookie: getSessionCookies()
    }
  };
};
import { colors, gradients, shadows, radius, roleThemes, fontFamily } from '../theme';
import { useAuth } from '../context/AuthContext';
import Toast from './Toast';
import { HStack, VStack } from './Stack';
import { cleanFieldData, cleanFieldValue } from '../utils/data';

/**
 * Bottom-to-top dynamic form drawer for adding/editing cards.
 */
export default function CardModalForm({ visible, onClose, tableId, cardId, onSuccess }) {
  const navigation = useNavigation();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const isEdit = !!cardId;
  const [fields, setFields] = useState([]);
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tableName, setTableName] = useState('');
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });
  const [error, setError] = useState(null);
  
  // Photo menu state
  const [photoMenu, setPhotoMenu] = useState({ visible: false, field: null, hasImage: false });

  const { user } = useAuth();
  const theme = roleThemes[user?.role] || roleThemes.default;

  const [shouldRender, setShouldRender] = useState(visible);
  const slideAnim = useRef(new Animated.Value(Dimensions.get('window').height)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible && isFocused) {
      const onBackPress = () => {
        if (photoMenu.visible) {
          setPhotoMenu(p => ({ ...p, visible: false }));
          return true;
        }
        onClose();
        return true;
      };
      BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => {
        BackHandler.removeEventListener('hardwareBackPress', onBackPress);
      };
    }
  }, [visible, isFocused, photoMenu.visible, onClose]);

  useEffect(() => {
    if (visible) {
      setShouldRender(true);
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        })
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: Dimensions.get('window').height,
          duration: 200,
          useNativeDriver: true,
        })
      ]).start(() => {
        setShouldRender(false);
      });
    }
  }, [visible]);

  const showToast = (msg, type = 'info') => setToast({ visible: true, message: msg, type });

  const loadData = async () => {
    if (!visible) return;
    setLoading(true);
    setError(null);
    try {
      // Load table fields
      let { ok: fOk, data: fData } = await apiGet(`/api/mobile/table/${tableId}/filter-options/?status=pending`);
      
      // Fallback: If filter-options didn't provide fields, try the table config endpoint
      if (!fOk || !fData?.data?.fields || fData.data.fields.length === 0) {
        const { ok: tOk, data: tData } = await apiGet(`/api/mobile/table/${tableId}/config/`);
        if (tOk && tData?.success && tData.data?.fields) {
          fData = tData;
          fOk = true;
          if (tData.data.table_name) setTableName(tData.data.table_name);
        }
      }

      if (fOk && fData?.success && fData.data?.fields) {
        setFields(fData.data.fields);
        if (fData.data.table_name) setTableName(fData.data.table_name);
      }

      // If editing, load existing card data
      if (isEdit) {
        const { ok: cOk, data: cData } = await apiGet(`/api/mobile/card/${cardId}/detail/`);
        if (cOk && cData?.success) {
          const cleaned = cleanFieldData(cData.data?.field_data || {});
          const activeFields = fData?.data?.fields || fields || [];
          
          Object.keys(cleaned).forEach(k => {
            if (typeof cleaned[k] === 'string') {
              // Check if key is an image field
              const isImg = activeFields.some(f => {
                if (f.name === k || (f.name || '').toUpperCase() === k.toUpperCase()) {
                  const t = (f.type || '').toLowerCase();
                  const n = (f.name || '').toLowerCase();
                  return t.includes('image') || t.includes('photo') || n.includes('photo') || (n.includes('sign') && !n.includes('designation')) || n.includes('pic');
                }
                return false;
              });
              
              if (!isImg) {
                cleaned[k] = cleaned[k].toUpperCase();
              }
            }
          });

          // Fallback: Populate main photo if missing or placeholder and cData.data.photo_url exists
          activeFields.forEach(f => {
            const nameLower = (f.name || '').toLowerCase();
            const typeLower = (f.type || '').toLowerCase();
            const isImg = typeLower.includes('image') || typeLower.includes('photo') || nameLower.includes('photo') || nameLower.includes('pic') || nameLower.includes('image');
            
            if (isImg) {
              const isMainPhoto = nameLower === 'photo' || nameLower === 'student_photo' || nameLower === 'student photo' || nameLower === 'image';
              const val = cleaned[f.name];
              const isEmpty = !val || val === 'NOT_FOUND' || String(val).startsWith('PENDING:');
              if (isEmpty && isMainPhoto && cData.data?.photo_url) {
                cleaned[f.name] = cData.data.photo_url;
              }
            }
          });

          setValues(cleaned);
          setTableName(cData.data?.table_name || '');
        } else if (!cOk) {
          setError('Failed to load card details');
        }
      } else {
        setValues({});
      }
    } catch (e) {
      setError('Network error - check your connection');
    }
    setLoading(false);
  };

  useEffect(() => { loadData(); }, [visible, cardId, tableId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const formData = new FormData();
      
      // Separate image URIs from regular data
      const fieldData = { ...values };
      
      for (const key in fieldData) {
        const val = fieldData[key];
        const isLocalUri = typeof val === 'string' && (
          val.startsWith('file://') || 
          val.startsWith('content://') || 
          val.startsWith('/') // Some Android paths
        );

        if (isLocalUri) {
          // It's a picked local image
          let filename = val.split('/').pop() || 'photo.jpg';
          const match = /\.(\w+)$/.exec(filename);
          let ext = match ? match[1].toLowerCase() : 'jpg';
          // Normalize extension aliases to correct MIME types
          const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', heif: 'image/heif' };
          let type = mimeMap[ext] || 'image/jpeg';
          if (!match) { filename += '.jpg'; ext = 'jpg'; }
          // Ensure filename always ends with a proper extension
          if (!filename.includes('.')) { filename = filename + '.' + ext; }
          
          // Use image_ prefix for dynamic fields to match backend expectation
          // PHOTO is a special field name in some tables, while others use lowercase photo
          const isMainPhoto = key.toUpperCase() === 'PHOTO' || key.toLowerCase() === 'photo';
          const fileKey = isMainPhoto ? 'photo' : `image_${key}`;
          
          formData.append(fileKey, { uri: val, name: filename, type });
          
          // Remove from field_data JSON so backend doesn't try to parse it as a string
          delete fieldData[key];
        }
      }

      formData.append('field_data', JSON.stringify(cleanFieldData(fieldData)));

      const url = isEdit
        ? `/api/mobile/table/${tableId}/card/${cardId}/update/`
        : `/api/mobile/table/${tableId}/card/add/`;

      const { data } = await apiPostForm(url, formData);
      if (data?.success) {
        showToast(data.message || (isEdit ? 'Updated!' : 'Saved!'), 'success');
        setTimeout(() => {
          onSuccess && onSuccess(data.card);
          onClose();
        }, 800);
      } else {
        showToast(data?.message || 'Failed to save', 'error');
      }
    } catch (e) { showToast('Network error', 'error'); }
    setSaving(false);
  };

  const handlePickFromGallery = async () => {
    const fieldName = photoMenu.field; // Capture BEFORE closing menu (avoids stale closure)
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
        allowsEditing: false, // Bypass system crop; use our custom crop screen
      });

      if (!result.canceled && result.assets && result.assets[0]) {
        const asset = result.assets[0];
        const uri = asset.uri;
        const width = asset.width || 1000;
        const height = asset.height || 1000;

        setPhotoMenu(p => ({ ...p, visible: false }));

        // Navigate to Camera screen for custom cropping
        navigation.navigate('Camera', {
          imageUri: uri,
          imageWidth: width,
          imageHeight: height,
          onCapture: (croppedUri) => setValues(prev => ({ ...prev, [fieldName]: croppedUri }))
        });
      }
    } catch (e) {
      console.warn('[Gallery] Error or permission denied:', e);
      Alert.alert(
        'Gallery Permission Required',
        'Gallery access is required to select photos. Please enable it in system settings.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => {
            if (Platform.OS === 'ios') Linking.openURL('app-settings:');
            else Linking.openSettings();
          }}
        ]
      );
    }
  };

  const fieldList = fields.length > 0
    ? fields.map(f => ({ name: f.name, type: f.type || 'text', mandatory: f.mandatory }))
    : Object.keys(values).filter(k => typeof values[k] === 'string').map(k => ({ name: k, type: 'text', mandatory: false }));

  if (!shouldRender) return null;

  return (
    <Animated.View style={[s.modalContainer, { opacity: fadeAnim }]}>
      <View style={s.overlay}>
        <TouchableOpacity style={s.dismissSpacer} activeOpacity={1} onPress={onClose} />
        
        <Animated.View style={[s.sheetWrap, { transform: [{ translateY: slideAnim }] }]}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
            <View style={s.sheet}>
              <View style={s.handle} />
              
              <View style={s.header}>
                <View style={s.titleBox}>
                  <Text style={s.title}>{isEdit ? 'Edit Student Card' : 'Add New Student'}</Text>
                  {tableName ? (
                    <Text style={s.subtitle}>{tableName}</Text>
                  ) : (
                    <Text style={s.subtitle}>Loading table details...</Text>
                  )}
                </View>
                <TouchableOpacity onPress={onClose} style={s.closeBtn}>
                  <DynamicIcon name="times" size={16} color={colors.gray400} />
                </TouchableOpacity>
              </View>

              {loading ? (
                <View style={s.loadingBox}>
                  <ActivityIndicator size="large" color={colors.brandPrimary} />
                  <Text style={s.loadingText}>Loading form fields...</Text>
                </View>
              ) : (
                <>
                  <ScrollView style={s.formScroll} contentContainerStyle={s.formScrollC} keyboardShouldPersistTaps="handled">
                    {/* Photos Section */}
                    <View style={s.photoSection}>
                      <HStack spacing={16} style={s.photoRow} justify="center">
                        {fieldList.filter(f => {
                          const t = (f.type || '').toLowerCase();
                          const n = (f.name || '').toLowerCase();
                          return t.includes('image') || t.includes('photo') || n.includes('photo') || (n.includes('sign') && !n.includes('designation')) || n.includes('pic');
                        }).map((field, i) => {
                          const val = values[field.name];
                          const hasImage = !!val && val !== 'NOT_FOUND' && !String(val).startsWith('PENDING:');
                          
                          return (
                            <View key={field.name + i} style={s.photoCard}>
                              <TouchableOpacity 
                                style={s.photoBox} 
                                onPress={() => setPhotoMenu({ visible: true, field: field.name, hasImage })}
                                activeOpacity={0.7}
                              >
                                {hasImage ? (
                                  <Image source={resolveImageSource(val)} style={s.photoImg} />
                                ) : (
                                  <View style={s.photoPlaceholder}>
                                    <DynamicIcon name="camera" size={24} color={colors.gray300} />
                                    <Text style={s.photoLabel}>{field.name}</Text>
                                  </View>
                                )}
                                <View style={s.photoEditIcon}>
                                  <DynamicIcon name={hasImage ? "ellipsis-h" : "plus"} size={10} color="#fff" />
                                </View>
                              </TouchableOpacity>
                            </View>
                          );
                        })}
                      </HStack>
                    </View>

                    <View style={s.fieldsWrap}>
                      {error && (
                        <HStack spacing={8} style={s.errorBox} align="center">
                          <DynamicIcon name="exclamation-circle" size={12} color="#ef4444" />
                          <Text style={s.errorText}>{error}</Text>
                        </HStack>
                      )}

                      {fieldList.length === 0 && !loading && (
                        <HStack spacing={12} style={s.noFieldsCard} align="center">
                          <DynamicIcon name="info-circle" size={14} color={colors.info} />
                          <Text style={s.noFieldsText}>No field definitions found.</Text>
                        </HStack>
                      )}

                      {fieldList.filter(f => {
                        const t = (f.type || '').toLowerCase();
                        const n = (f.name || '').toLowerCase();
                        const isImg = t.includes('image') || t.includes('photo') || n.includes('photo') || (n.includes('sign') && !n.includes('designation')) || n.includes('pic');
                        return !isImg;
                      }).map((field, i) => {
                        return (
                          <View key={field.name + i} style={s.field}>
                            <HStack spacing={6} style={s.fieldLabelRow} align="center">
                              <Text style={s.fieldLabel}>{field.name}</Text>
                              {field.mandatory && <View style={s.mandatoryDot} />}
                            </HStack>
                            <TextInput
                              style={s.fieldInput}
                              value={values[field.name] || ''}
                              onChangeText={t => setValues(prev => ({ ...prev, [field.name]: t.toUpperCase() }))}
                              placeholder={`Enter ${field.name.toLowerCase()}`}
                              placeholderTextColor={colors.gray300}
                            />
                          </View>
                        );
                      })}
                      <View style={{ height: 20 }} />
                    </View>
                  </ScrollView>

                  {/* Fixed Footer at bottom of sheet */}
                  <View style={[s.footerContainer, { paddingBottom: (insets.bottom || 0) > 0 ? (insets.bottom || 0) + 12 : 28 }]}>
                    <HStack spacing={12} style={s.footer} align="center">
                      <TouchableOpacity onPress={onClose} style={s.cancelBtn}>
                        <Text style={s.cancelBtnText}>Discard</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={handleSave} disabled={saving || fieldList.length === 0} activeOpacity={0.85} style={s.saveBtnWrap}>
                        <LinearGradient colors={theme.gradient} start={{x:0, y:0}} end={{x:1, y:0}} style={s.saveBtn}>
                          {saving ? (
                            <ActivityIndicator size="small" color="#fff" />
                          ) : (
                            <Text style={s.saveBtnText}>{isEdit ? 'Update' : 'Save Entry'}</Text>
                          )}
                        </LinearGradient>
                      </TouchableOpacity>
                    </HStack>
                  </View>
                </>
              )}
            </View>
          </KeyboardAvoidingView>
        </Animated.View>
      </View>
      <Toast visible={toast.visible} message={toast.message} type={toast.type} onHide={() => setToast(p => ({ ...p, visible: false }))} />

      {/* Photo Options Drawer Menu */}
      {photoMenu.visible && (
        <View style={s.menuOverlayContainer}>
          <TouchableOpacity style={s.menuOverlay} activeOpacity={1} onPress={() => setPhotoMenu(p => ({ ...p, visible: false }))}>
            <View style={s.menuContent}>
              <Text style={s.menuTitle}>Manage {photoMenu.field}</Text>
              
              <HStack spacing={14} style={s.menuItem} align="center" onStartShouldSetResponder={() => false}>
                <TouchableOpacity style={{flexDirection:'row', alignItems:'center', width:'100%'}} onPress={() => {
                const captureField = photoMenu.field; // Capture BEFORE closing menu
                setPhotoMenu(p => ({ ...p, visible: false }));
                navigation.navigate('Camera', { 
                  onCapture: (uri) => setValues(prev => ({ ...prev, [captureField]: uri })) 
                });
                }}>
                  <View style={[s.menuIconBox, { backgroundColor: '#eef2ff' }]}><DynamicIcon name="camera" size={14} color="#6366f1" /></View>
                  <Text style={s.menuItemText}>Take New Photo</Text>
                </TouchableOpacity>
              </HStack>

              <HStack spacing={14} style={s.menuItem} align="center">
                <TouchableOpacity style={{flexDirection:'row', alignItems:'center', width:'100%'}} onPress={handlePickFromGallery}>
                  <View style={[s.menuIconBox, { backgroundColor: '#f0fdf4' }]}><DynamicIcon name="images" size={14} color="#22c55e" /></View>
                  <Text style={s.menuItemText}>Choose from Gallery</Text>
                </TouchableOpacity>
              </HStack>

              {photoMenu.hasImage && (
                <HStack spacing={14} style={s.menuItem} align="center">
                  <TouchableOpacity style={{flexDirection:'row', alignItems:'center', width:'100%'}} onPress={() => {
                    setValues(prev => ({ ...prev, [photoMenu.field]: '' }));
                    setPhotoMenu(p => ({ ...p, visible: false }));
                  }}>
                    <View style={[s.menuIconBox, { backgroundColor: '#fef2f2' }]}><DynamicIcon name="trash-alt" size={14} color="#ef4444" /></View>
                    <Text style={[s.menuItemText, { color: '#ef4444' }]}>Remove Current Photo</Text>
                  </TouchableOpacity>
                </HStack>
              )}

              <TouchableOpacity style={s.menuCancel} onPress={() => setPhotoMenu(p => ({ ...p, visible: false }))}>
                <Text style={s.menuCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </View>
      )}
    </Animated.View>
  );
}

const s = StyleSheet.create({
  modalContainer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999, width: '100%', height: '100%' },
  menuOverlayContainer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000, backgroundColor: 'rgba(0,0,0,0.4)' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  dismissSpacer: { flex: 1 },
  sheetWrap: { width: '100%', height: '90%' },
  sheet: { flex: 1, backgroundColor: '#fff', borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, ...shadows.xl, overflow: 'hidden' },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#e5e7eb', alignSelf: 'center', marginTop: 10, marginBottom: 4 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  titleBox: { flex: 1 },
  title: { fontSize: 18, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray800 },
  subtitle: { fontSize: 11, fontFamily: 'SairaSemiCondensed-Medium', color: colors.gray400, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 },
  closeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.gray50, alignItems: 'center', justifyContent: 'center' },
  
  formScroll: { flex: 1 },
  formScrollC: { padding: 16, paddingBottom: 40 },
  
  photoSection: { backgroundColor: '#fcfcfc', paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#f1f5f9', marginBottom: 16 },
  photoRow: { flexDirection: 'row', justifyContent: 'center' },
  photoCard: { alignItems: 'center' },
  photoBox: { width: 100, height: 110, backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: '#e2e8f0', overflow: 'hidden', justifyContent: 'center', alignItems: 'center', ...shadows.sm },
  photoImg: { width: '100%', height: '100%', resizeMode: 'cover' },
  photoPlaceholder: { alignItems: 'center' },
  photoLabel: { fontSize: 9, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray400, textTransform: 'uppercase' },
  photoEditIcon: { position: 'absolute', bottom: 6, right: 6, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },

  fieldsWrap: { marginTop: 4 },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 100 },
  loadingText: { marginTop: 12, fontSize: 13, color: colors.gray400, fontFamily: 'SairaSemiCondensed-Medium' },
  errorBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fef2f2', padding: 12, borderRadius: radius.md, marginBottom: 20, borderWidth: 1, borderColor: '#fecaca' },
  errorText: { fontSize: 12, color: '#991b1b', fontFamily: 'SairaSemiCondensed-Medium' },
  noFieldsCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#eff6ff', borderRadius: radius.md, padding: 16, borderWidth: 1, borderColor: '#dbeafe', marginBottom: 20 },
  noFieldsText: { flex: 1, fontSize: 12, color: '#1e40af', fontFamily: 'SairaSemiCondensed-Medium' },
  field: { marginBottom: 20 },
  fieldLabelRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, paddingLeft: 2 },
  fieldLabel: { fontSize: 11, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray600, letterSpacing: 0.5, textTransform: 'uppercase' },
  mandatoryDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#f43f5e' },
  fieldInput: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: radius.sm, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, color: colors.gray900, fontFamily: 'SairaSemiCondensed-SemiBold' },
  
  footerContainer: { padding: 16, borderTopWidth: 1, borderTopColor: '#f1f5f9', backgroundColor: '#fff', paddingBottom: Platform.OS === 'ios' ? 34 : 16 },
  footer: { flexDirection: 'row', alignItems: 'center' },
  saveBtnWrap: { flex: 2, borderRadius: radius.sm, overflow: 'hidden', ...shadows.md },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 16 },
  saveBtnText: { fontSize: 15, fontFamily: 'SairaSemiCondensed-Bold', color: '#fff' },
  cancelBtn: { flex: 1, paddingVertical: 16, alignItems: 'center', backgroundColor: colors.gray100, borderRadius: radius.sm },
  cancelBtnText: { fontSize: 14, fontFamily: 'SairaSemiCondensed-SemiBold', color: colors.gray500 },

  // Menu styles
  menuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end', padding: 16 },
  menuContent: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 8, ...shadows.xl },
  menuTitle: { fontSize: 13, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray400, textTransform: 'uppercase', textAlign: 'center', paddingVertical: 12, letterSpacing: 1 },
  menuItem: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: radius.md },
  menuIconBox: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  menuItemText: { fontSize: 15, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray800 },
  menuCancel: { marginTop: 8, paddingVertical: 16, alignItems: 'center', borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  menuCancelText: { fontSize: 15, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray400 },
});
