import React, { useState, useEffect } from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, Linking, AppState, Dimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, radius, fontFamily, typography, shadows } from '../theme';
import { IconDownload } from './Icons';
import { apiGet } from '../api/client';

const { width } = Dimensions.get('window');

function isVersionOlder(current, latest) {
  if (!current || !latest) return false;
  const parse = v => String(v).replace(/[^0-9.]/g, '').split('.').map(Number);
  const curParts = parse(current);
  const latParts = parse(latest);
  for (let i = 0; i < Math.max(curParts.length, latParts.length); i++) {
    const c = curParts[i] || 0;
    const l = latParts[i] || 0;
    if (c < l) return true;
    if (c > l) return false;
  }
  return false;
}

export default function UpdatePromptModal() {
  const [modalVisible, setModalVisible] = useState(false);
  const [latestVersion, setLatestVersion] = useState('');
  const [playStoreUrl, setPlayStoreUrl] = useState('https://play.google.com/store/apps/details?id=com.adarshid.app');
  const [isDismissed, setIsDismissed] = useState(false);

  const currentVersion = Constants?.expoConfig?.version || '1.0.54';

  const checkForUpdates = async () => {
    try {
      const response = await apiGet('/api/mobile/app-version/');
      if (response && response.ok && response.data?.success) {
        const remoteVersion = response.data.latest_version;
        const storeUrl = response.data.play_store_url || 'https://play.google.com/store/apps/details?id=com.adarshid.app';
        
        setLatestVersion(remoteVersion);
        setPlayStoreUrl(storeUrl);

        if (isVersionOlder(currentVersion, remoteVersion)) {
          setModalVisible(true);
        } else {
          setModalVisible(false);
        }
      }
    } catch (e) {
      console.warn('[UpdateCheck] Failed to check for updates:', e);
    }
  };

  useEffect(() => {
    // Initial check on mount
    checkForUpdates();

    // Re-check when app comes to foreground
    const handleAppStateChange = (nextAppState) => {
      if (nextAppState === 'active' && !isDismissed) {
        checkForUpdates();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      subscription.remove();
    };
  }, [isDismissed]);

  const handleUpdate = () => {
    Linking.openURL(playStoreUrl).catch((err) => {
      // Fallback redirect if linking fails
      const fallbackUrl = 'https://play.google.com/store/apps/details?id=com.adarshid.app';
      Linking.openURL(fallbackUrl).catch(() => {});
    });
  };

  const handleDismiss = () => {
    setIsDismissed(true);
    setModalVisible(false);
  };

  if (!modalVisible || isDismissed) {
    return null;
  }

  return (
    <Modal
      transparent
      animationType="fade"
      visible={modalVisible}
      onRequestClose={handleDismiss}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          {/* Accent border top */}
          <LinearGradient
            colors={[colors.brandPrimary, colors.brandSecondary]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.gradientHeader}
          />
          
          <View style={styles.content}>
            {/* Premium circle icon container */}
            <LinearGradient
              colors={[colors.brandPrimary, colors.brandSecondary]}
              style={styles.iconCircle}
            >
              <IconDownload size={30} color={colors.white} />
            </LinearGradient>

            <Text style={styles.title}>UPDATE AVAILABLE</Text>
            
            <Text style={styles.subtitle}>
              New Premium Version {latestVersion} is Ready
            </Text>

            <Text style={styles.message}>
              A new premium build is available with latest features, performance improvements, and critical bug fixes. Please update now to ensure stable and smooth operations.
            </Text>

            <TouchableOpacity 
              activeOpacity={0.8} 
              onPress={handleUpdate}
              style={styles.buttonContainer}
            >
              <LinearGradient
                colors={[colors.brandPrimary, colors.brandSecondary]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.button}
              >
                <Text style={styles.buttonText}>UPDATE NOW</Text>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity 
              activeOpacity={0.7} 
              onPress={handleDismiss}
              style={styles.laterButton}
            >
              <Text style={styles.laterText}>Maybe Later</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.85)', // dark slate glassmorphism
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: width * 0.85,
    backgroundColor: colors.white,
    borderRadius: radius.lg, // very low radius to match styling guidelines (6px)
    overflow: 'hidden',
    ...shadows.xl,
  },
  gradientHeader: {
    height: 4,
    width: '100%',
  },
  content: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 24,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    ...shadows.md,
  },
  title: {
    fontSize: typography.xl,
    fontFamily: fontFamily.bold,
    color: colors.gray900,
    letterSpacing: 1.5,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: typography.base,
    fontFamily: fontFamily.medium,
    color: colors.brandSecondary,
    marginTop: 6,
    textAlign: 'center',
  },
  message: {
    fontSize: typography.md,
    fontFamily: fontFamily.regular,
    color: colors.gray500,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 16,
    marginBottom: 28,
  },
  buttonContainer: {
    width: '100%',
  },
  button: {
    paddingVertical: 14,
    borderRadius: radius.md, // 4px border radius to match guidelines
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.sm,
  },
  buttonText: {
    color: colors.white,
    fontFamily: fontFamily.bold,
    fontSize: typography.base,
    letterSpacing: 1,
  },
  laterButton: {
    marginTop: 16,
    paddingVertical: 8,
    width: '100%',
    alignItems: 'center',
  },
  laterText: {
    color: colors.gray400,
    fontFamily: fontFamily.medium,
    fontSize: typography.sm,
  },
});
