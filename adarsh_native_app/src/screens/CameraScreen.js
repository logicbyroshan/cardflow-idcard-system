import React, { useState, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Image, Alert } from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import TopBar from '../components/TopBar';
import Toast from '../components/Toast';
import { apiPostForm } from '../api/client';
import { colors, gradients, shadows } from '../theme';

export default function CameraScreen({ navigation, route }) {
  const { tableId, cardId } = route.params;
  const insets = useSafeAreaInsets();
  const [photo, setPhoto] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });
  const showToast = (msg, type = 'info') => setToast({ visible: true, message: msg, type });

  // Use Expo ImagePicker for cross-platform camera + gallery
  const pickImage = async (useCamera = true) => {
    try {
      // Dynamic import to avoid crash if not installed yet
      const ImagePicker = require('expo-image-picker');

      let permResult;
      if (useCamera) {
        permResult = await ImagePicker.requestCameraPermissionsAsync();
      } else {
        permResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      }

      if (!permResult.granted) {
        Alert.alert('Permission Required', `Please grant ${useCamera ? 'camera' : 'gallery'} access to continue.`);
        return;
      }

      const result = useCamera
        ? await ImagePicker.launchCameraAsync({ allowsEditing: true, quality: 0.8, aspect: [3, 4] })
        : await ImagePicker.launchImageLibraryAsync({ allowsEditing: true, quality: 0.8, aspect: [3, 4] });

      if (!result.canceled && result.assets && result.assets[0]) {
        setPhoto(result.assets[0]);
      }
    } catch (e) {
      showToast('Camera not available in web preview. Use a device.', 'error');
    }
  };

  const uploadPhoto = async () => {
    if (!photo) { showToast('No photo selected', 'error'); return; }
    setUploading(true);
    try {
      const formData = new FormData();
      const uri = photo.uri;
      const fileName = uri.split('/').pop() || 'photo.jpg';
      formData.append('photo', { uri, name: fileName, type: 'image/jpeg' });
      if (cardId) formData.append('card_id', cardId.toString());

      const { data } = await apiPostForm(`/app/api/table/${tableId}/upload-photo/`, formData);
      showToast(data?.success ? (data.message || 'Photo uploaded!') : (data?.message || 'Upload failed'), data?.success ? 'success' : 'error');
      if (data?.success) setTimeout(() => navigation.goBack(), 800);
    } catch (e) { showToast('Network error', 'error'); }
    setUploading(false);
  };

  return (
    <View style={[s.root, { paddingBottom: insets.bottom }]}>
      <TopBar title="Capture Photo" subtitle={cardId ? `Card #${cardId}` : 'New photo'} onBack={() => navigation.goBack()} />

      <View style={s.content}>
        {/* Preview Area */}
        <View style={s.previewCard}>
          {photo ? (
            <Image source={{ uri: photo.uri }} style={s.previewImage} resizeMode="cover" />
          ) : (
            <View style={s.previewPlaceholder}>
              <View style={s.cameraIconWrap}><FontAwesome5 name="camera" size={36} color={colors.gray300} /></View>
              <Text style={s.previewText}>Take a photo or select from gallery</Text>
            </View>
          )}
        </View>

        {/* Action Buttons */}
        <View style={s.actions}>
          <View style={s.captureRow}>
            <TouchableOpacity onPress={() => pickImage(false)} style={s.galleryBtn} activeOpacity={0.7}>
              <FontAwesome5 name="images" size={18} color={colors.brandLight} solid />
              <Text style={s.galleryBtnText}>Gallery</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => pickImage(true)} activeOpacity={0.85} style={s.cameraBtnWrap}>
              <LinearGradient colors={gradients.brand} style={s.cameraBtn}>
                <FontAwesome5 name="camera" size={20} color="#fff" solid />
              </LinearGradient>
            </TouchableOpacity>

            {photo && (
              <TouchableOpacity onPress={() => setPhoto(null)} style={s.retakeBtn} activeOpacity={0.7}>
                <FontAwesome5 name="redo" size={18} color="#ef4444" />
                <Text style={s.retakeBtnText}>Retake</Text>
              </TouchableOpacity>
            )}
          </View>

          {photo && (
            <TouchableOpacity onPress={uploadPhoto} disabled={uploading} activeOpacity={0.85} style={s.uploadBtnWrap}>
              <LinearGradient colors={['#22c55e', '#16a34a']} style={s.uploadBtn}>
                {uploading ? <ActivityIndicator size="small" color="#fff" /> : <FontAwesome5 name="cloud-upload-alt" size={14} color="#fff" solid />}
                <Text style={s.uploadBtnText}>{uploading ? 'Uploading...' : 'Upload Photo'}</Text>
              </LinearGradient>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <Toast visible={toast.visible} message={toast.message} type={toast.type} onHide={() => setToast(p => ({ ...p, visible: false }))} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceBg },
  content: { flex: 1, padding: 16, justifyContent: 'space-between' },
  previewCard: { flex: 1, backgroundColor: '#fff', borderRadius: 24, overflow: 'hidden', borderWidth: 1, borderColor: '#e2e8f0', ...shadows.md, marginBottom: 16 },
  previewImage: { width: '100%', height: '100%' },
  previewPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.gray50 },
  cameraIconWrap: { width: 80, height: 80, borderRadius: 24, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.gray200, marginBottom: 12, ...shadows.sm },
  previewText: { fontSize: 13, color: colors.gray400, fontWeight: '500' },
  actions: { gap: 12 },
  captureRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16 },
  galleryBtn: { alignItems: 'center', gap: 4 },
  galleryBtnText: { fontSize: 10, fontWeight: '600', color: colors.brandLight },
  cameraBtnWrap: { borderRadius: 32, overflow: 'hidden', ...shadows.lg },
  cameraBtn: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  retakeBtn: { alignItems: 'center', gap: 4 },
  retakeBtnText: { fontSize: 10, fontWeight: '600', color: '#ef4444' },
  uploadBtnWrap: { borderRadius: 20, overflow: 'hidden', ...shadows.md },
  uploadBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16, borderRadius: 20 },
  uploadBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});
