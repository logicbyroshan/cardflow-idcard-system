import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { DynamicIcon } from '../components/Icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, gradients, typography, radius, shadows, fontFamily } from '../theme';
import { BASE_URL } from '../api/client';

export default function NoAccessScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const message = route?.params?.message || "You don't have permission to access this page. Please contact your administrator if you believe this is an error.";

  return (
    <View style={[s.root, { paddingTop: insets.top + 60, paddingBottom: insets.bottom }]}>
      <View style={s.card}>
        <View style={s.iconWrap}>
          <DynamicIcon name="lock" size={32} color={colors.brandPrimary} />
        </View>

        <Text style={s.title}>Access Denied</Text>
        <Text style={s.message}>{message}</Text>

        <View style={s.footer}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={s.backBtn}
            activeOpacity={0.7}
          >
            <Text style={s.backBtnText}>Go Back</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => navigation.navigate('Home')}
            activeOpacity={0.85}
            style={s.homeBtnWrap}
          >
            <LinearGradient
              colors={gradients.brand}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={s.homeBtn}
            >
              <Text style={s.homeBtnText}>Back to Dashboard</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceBg, paddingHorizontal: 24 },
  card: {
    backgroundColor: '#fff',
    borderRadius: radius.xxl,
    padding: 32,
    alignItems: 'center',
    ...shadows.xl,
    borderWidth: 1,
    borderColor: colors.gray100,
  },
  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: `${colors.brandPrimary}10`,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 22,
    fontFamily: 'SairaSemiCondensed-Bold',
    color: colors.gray800,
    marginBottom: 12,
    textAlign: 'center',
  },
  message: {
    fontSize: 15,
    fontFamily: 'SairaSemiCondensed-Regular',
    color: colors.gray500,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
  },
  footer: { width: '100%' },
  backBtn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.gray200,
    alignItems: 'center',
    marginBottom: 12,
  },
  backBtnText: {
    fontSize: 14,
    fontFamily: 'SairaSemiCondensed-SemiBold',
    color: colors.gray600,
  },
  homeBtnWrap: {
    width: '100%',
    borderRadius: radius.xl,
    overflow: 'hidden',
  },
  homeBtn: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  homeBtnText: {
    fontSize: 14,
    fontFamily: 'SairaSemiCondensed-Bold',
    color: '#fff',
  },
});
