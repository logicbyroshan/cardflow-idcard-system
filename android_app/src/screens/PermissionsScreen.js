import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Linking, Platform } from 'react-native';
import { DynamicIcon } from '../components/Icons';
import { LinearGradient } from 'expo-linear-gradient';
import TopBar from '../components/TopBar';
import Toast from '../components/Toast';
import { colors, gradients, shadows, radius } from '../theme';
import * as ImagePicker from 'expo-image-picker';

export default function PermissionsScreen({ navigation }) {
  const [permissions, setPermissions] = useState({
    camera: 'undetermined',
    mediaLibrary: 'undetermined',
  });
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });

  const showToast = (msg, type = 'info') => setToast({ visible: true, message: msg, type });

  const checkPermissions = useCallback(async () => {
    try {
      const cam = await ImagePicker.getCameraPermissionsAsync();
      const media = await ImagePicker.getMediaLibraryPermissionsAsync();
      setPermissions({
        camera: cam.status,
        mediaLibrary: media.status,
      });
    } catch (e) {
      // silent
    }
  }, []);

  useEffect(() => { checkPermissions(); }, [checkPermissions]);

  const requestCamera = async () => {
    try {
      const result = await ImagePicker.requestCameraPermissionsAsync();
      setPermissions(p => ({ ...p, camera: result.status }));
      if (result.status === 'granted') showToast('Camera access granted!', 'success');
      else if (result.status === 'denied') {
        showToast('Permission denied. Enable in Settings.', 'warn');
      }
    } catch (e) { showToast('Failed to request permission', 'error'); }
  };

  const requestMediaLibrary = async () => {
    try {
      const result = await ImagePicker.requestMediaLibraryPermissionsAsync();
      setPermissions(p => ({ ...p, mediaLibrary: result.status }));
      if (result.status === 'granted') showToast('Photo library access granted!', 'success');
      else if (result.status === 'denied') {
        showToast('Permission denied. Enable in Settings.', 'warn');
      }
    } catch (e) { showToast('Failed to request permission', 'error'); }
  };

  const openAppSettings = () => {
    if (Platform.OS === 'ios') Linking.openURL('app-settings:');
    else Linking.openSettings();
  };

  const PERMISSION_ITEMS = [
    {
      key: 'camera',
      icon: 'camera',
      iconColor: '#3b82f6',
      iconBg: '#dbeafe',
      title: 'Camera',
      description: 'Required for capturing ID card photos directly from the app',
      status: permissions.camera,
      onRequest: requestCamera,
    },
    {
      key: 'mediaLibrary',
      icon: 'images',
      iconColor: '#8b5cf6',
      iconBg: '#ede9fe',
      title: 'Photo Library',
      description: 'Required for selecting existing photos from your gallery',
      status: permissions.mediaLibrary,
      onRequest: requestMediaLibrary,
    },
  ];

  const getStatusConfig = (status) => {
    switch (status) {
      case 'granted': return { label: 'Granted', color: '#22c55e', bg: '#dcfce7', icon: 'check-circle' };
      case 'denied': return { label: 'Denied', color: '#ef4444', bg: '#fef2f2', icon: 'times-circle' };
      default: return { label: 'Not Set', color: '#f59e0b', bg: '#fef3c7', icon: 'exclamation-circle' };
    }
  };

  return (
    <View style={s.root}>
      <TopBar title="Permissions" subtitle="Manage app permissions" onBack={() => navigation.goBack()} />
      <ScrollView style={s.scroll} contentContainerStyle={s.scrollC} showsVerticalScrollIndicator={false}>
        {/* Header Info */}
        <View style={s.infoCard}>
          <View style={s.infoIcon}><DynamicIcon name="shield-alt" size={16} color={colors.brandPrimary} /></View>
          <Text style={s.infoText}>
            These permissions are needed for the app to function properly. You can grant or revoke them at any time.
          </Text>
        </View>

        {/* Permission Items */}
        {PERMISSION_ITEMS.map(item => {
          const sc = getStatusConfig(item.status);
          return (
            <View key={item.key} style={s.permCard}>
              <View style={s.permTop}>
                <View style={[s.permIcon, { backgroundColor: item.iconBg }]}>
                  <DynamicIcon name={item.icon} size={16} color={item.iconColor} />
                </View>
                <View style={s.permInfo}>
                  <Text style={s.permTitle}>{item.title}</Text>
                  <Text style={s.permDesc}>{item.description}</Text>
                </View>
              </View>
              <View style={s.permBottom}>
                <View style={[s.statusBadge, { backgroundColor: sc.bg }]}>
                  <DynamicIcon name={sc.icon} size={10} color={sc.color} />
                  <Text style={[s.statusLabel, { color: sc.color }]}>{sc.label}</Text>
                </View>
                {item.status !== 'granted' && (
                  <TouchableOpacity onPress={item.onRequest} activeOpacity={0.7} style={s.grantBtnWrap}>
                    <LinearGradient colors={gradients.brand} start={{x:0,y:0}} end={{x:1,y:0}} style={s.grantBtn}>
                      <Text style={s.grantBtnText}>Grant Access</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          );
        })}

        {/* Open Settings */}
        <TouchableOpacity onPress={openAppSettings} style={s.settingsBtn} activeOpacity={0.7}>
          <DynamicIcon name="cog" size={14} color={colors.gray500} />
          <Text style={s.settingsBtnText}>Open System Settings</Text>
          <DynamicIcon name="external-link-alt" size={10} color={colors.gray400} />
        </TouchableOpacity>

        <Text style={s.hint}>
          If a permission is denied, you may need to enable it manually from your device's Settings app.
        </Text>
      </ScrollView>
      <Toast visible={toast.visible} message={toast.message} type={toast.type} onHide={() => setToast(p => ({...p, visible: false}))} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceBg },
  scroll: { flex: 1 },
  scrollC: { padding: 16, paddingBottom: 40 },
  infoCard: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: '#eff6ff', borderRadius: radius.sm, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#dbeafe' },
  infoIcon: { width: 36, height: 36, borderRadius: radius.xs, backgroundColor: '#dbeafe', alignItems: 'center', justifyContent: 'center' },
  infoText: { flex: 1, fontSize: 12, color: '#1e40af', lineHeight: 18 },
  permCard: { backgroundColor: '#fff', borderRadius: radius.sm, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#f1f5f9', ...shadows.sm },
  permTop: { flexDirection: 'row', alignItems: 'flex-start' },
  permIcon: { width: 44, height: 44, borderRadius: radius.xs, alignItems: 'center', justifyContent: 'center' },
  permInfo: { flex: 1 },
  permTitle: { fontSize: 14, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray800 },
  permDesc: { fontSize: 11, color: colors.gray500, marginTop: 4, lineHeight: 16 },
  permBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  statusBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.xs },
  statusLabel: { fontSize: 11, fontFamily: 'SairaSemiCondensed-Bold' },
  grantBtnWrap: { borderRadius: radius.sm, overflow: 'hidden' },
  grantBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.sm },
  grantBtnText: { fontSize: 11, fontFamily: 'SairaSemiCondensed-Bold', color: '#fff' },
  settingsBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, backgroundColor: '#fff', borderRadius: radius.sm, borderWidth: 1, borderColor: '#e2e8f0', marginTop: 8, ...shadows.sm },
  settingsBtnText: { fontSize: 13, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray600 },
  hint: { fontSize: 11, color: colors.gray400, textAlign: 'center', marginTop: 16, lineHeight: 16, paddingHorizontal: 20 },
});
