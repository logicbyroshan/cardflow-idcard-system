import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { DynamicIcon } from '../components/Icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, gradients, typography, spacing, radius, shadows, fontFamily } from '../theme';
import { BASE_URL } from '../api/client';

export default function DesktopRequiredScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const statusDisplay = route?.params?.statusDisplay || 'This feature';

  return (
    <View style={[styles.root, { paddingTop: insets.top + 40, paddingBottom: insets.bottom }]}>
      <View style={styles.card}>
        {/* Icon */}
        <View style={styles.iconWrap}>
          <DynamicIcon name="desktop" size={24} color="#f59e0b" />
        </View>

        <Text style={styles.title}>{statusDisplay} Is Desktop Only</Text>
        <Text style={styles.message}>
          This list is not available in the mobile app. Please open the desktop panel to continue.
        </Text>

        <View style={styles.buttons}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.secondaryBtn}
            activeOpacity={0.7}
          >
            <Text style={styles.secondaryBtnText}>Back</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => Linking.openURL(`${BASE_URL}/panel/`)}
            activeOpacity={0.85}
            style={styles.primaryBtnWrap}
          >
            <LinearGradient
              colors={gradients.brand}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.primaryBtn}
            >
              <Text style={styles.primaryBtnText}>Open Desktop Panel</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surfaceBg,
    paddingHorizontal: 16,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.xxl + 4,
    borderWidth: 1,
    borderColor: colors.indigo100,
    padding: 24,
    alignItems: 'center',
    ...shadows.sm,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: radius.xl,
    backgroundColor: '#fffbeb',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: typography.xxl,
    fontFamily: 'SairaSemiCondensed-Bold',
    color: colors.gray800,
    textAlign: 'center',
    marginBottom: 8,
  },
  message: {
    fontSize: typography.base,
    color: colors.gray500,
    textAlign: 'center',
    lineHeight: 20,
  },
  buttons: {
    width: '100%',
    marginTop: 20,
  },
  secondaryBtn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.gray200,
    backgroundColor: colors.gray50,
    alignItems: 'center',
  },
  secondaryBtnText: {
    fontSize: typography.base,
    fontFamily: 'SairaSemiCondensed-SemiBold',
    color: colors.gray700,
  },
  primaryBtnWrap: {
    width: '100%',
    borderRadius: radius.xl,
    overflow: 'hidden',
    ...shadows.md,
  },
  primaryBtn: {
    paddingVertical: 14,
    borderRadius: radius.xl,
    alignItems: 'center',
  },
  primaryBtnText: {
    fontSize: typography.base,
    fontFamily: 'SairaSemiCondensed-Bold',
    color: colors.white,
  },
});
