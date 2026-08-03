import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { DynamicIcon } from '../components/Icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, gradients, radius, shadows, typography } from '../theme';
import { useAuth } from '../context/AuthContext';

export default function KickedScreen() {
  const insets = useSafeAreaInsets();
  const { resolveKicked } = useAuth();

  return (
    <View style={[s.root, { paddingTop: insets.top + 80, paddingBottom: insets.bottom + 40 }]}>
      <View style={s.card}>
        <View style={s.iconWrap}>
          <DynamicIcon name="user-slash" size={32} color={colors.red} />
        </View>

        <Text style={s.title}>Logged In Elsewhere</Text>
        <Text style={s.message}>
          This device has been logged out because your account was used to log in on another device.
        </Text>
        <Text style={s.subMessage}>
          Please log in here again to continue using the app on this device.
        </Text>

        <View style={s.footer}>
          <TouchableOpacity
            onPress={resolveKicked}
            activeOpacity={0.85}
            style={s.loginBtnWrap}
          >
            <LinearGradient
              colors={gradients.brand}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={s.loginBtn}
            >
              <Text style={s.loginBtnText}>Log In Here Again</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceBg, paddingHorizontal: 24, justifyContent: 'center' },
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
    backgroundColor: `${colors.red}10`,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 22,
    fontFamily: 'SairaSemiCondensed-Bold',
    color: colors.gray800,
    marginBottom: 16,
    textAlign: 'center',
  },
  message: {
    fontSize: 15,
    fontFamily: 'SairaSemiCondensed-SemiBold',
    color: colors.gray600,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 12,
  },
  subMessage: {
    fontSize: 13,
    fontFamily: 'SairaSemiCondensed-Regular',
    color: colors.gray400,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 32,
  },
  footer: { width: '100%' },
  loginBtnWrap: {
    width: '100%',
    borderRadius: radius.xl,
    overflow: 'hidden',
  },
  loginBtn: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  loginBtnText: {
    fontSize: 14,
    fontFamily: 'SairaSemiCondensed-Bold',
    color: '#fff',
  },
});
