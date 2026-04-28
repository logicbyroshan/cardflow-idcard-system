import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { FontAwesome5 } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, gradients, shadows } from '../theme';

export default function WelcomeScreen({ navigation }) {
  const insets = useSafeAreaInsets();

  return (
    <LinearGradient colors={['#667eea', '#764ba2', '#5b21b6']} start={{ x: 0.3, y: 0 }} end={{ x: 0.7, y: 1 }} style={s.root}>
      {/* Decorative bubbles */}
      <View style={[s.bubble, { width: 240, height: 240, top: -80, right: -80 }]} />
      <View style={[s.bubble, { width: 160, height: 160, bottom: 200, left: -60 }]} />
      <View style={[s.bubble, { width: 80, height: 80, top: '35%', right: 30 }]} />

      <View style={[s.content, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 30 }]}>
        {/* Top Section — Logo + Branding */}
        <View style={s.brandSection}>
          <View style={s.logoWrap}>
            <FontAwesome5 name="id-card" size={40} color="#fff" solid />
          </View>
          <Text style={s.brandName}>Adarsh ID Cards</Text>
          <Text style={s.brandTagline}>Smart Card Management System</Text>
        </View>

        {/* Middle — Feature highlights */}
        <View style={s.features}>
          {[
            { icon: 'shield-alt', label: 'Secure Login', sub: 'Protected authentication' },
            { icon: 'bolt', label: 'Instant Access', sub: 'Manage cards on the go' },
            { icon: 'sync-alt', label: 'Real-time Sync', sub: 'Always up to date' },
          ].map((f, i) => (
            <View key={i} style={s.featureRow}>
              <View style={s.featureIcon}><FontAwesome5 name={f.icon} size={14} color="#fff" solid /></View>
              <View style={s.featureInfo}>
                <Text style={s.featureLabel}>{f.label}</Text>
                <Text style={s.featureSub}>{f.sub}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Bottom — CTA Buttons */}
        <View style={s.bottomCta}>
          <TouchableOpacity onPress={() => navigation.navigate('Login')} activeOpacity={0.85} style={s.signInBtnWrap}>
            <View style={s.signInBtn}>
              <Text style={s.signInText}>Sign In</Text>
              <FontAwesome5 name="arrow-right" size={13} color={colors.brandDark} />
            </View>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => navigation.navigate('ForgotPassword')} activeOpacity={0.7}>
            <Text style={s.forgotText}>Forgot Password?</Text>
          </TouchableOpacity>

          <Text style={s.versionText}>v1.0.0 • Adarsh Bhopal</Text>
        </View>
      </View>
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  bubble: { position: 'absolute', borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  content: { flex: 1, paddingHorizontal: 28, justifyContent: 'space-between' },
  brandSection: { alignItems: 'center', paddingTop: 20 },
  logoWrap: { width: 100, height: 100, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)', marginBottom: 16, ...shadows.xl },
  brandName: { fontSize: 28, fontFamily: 'SairaSemiCondensed-Bold', color: '#fff', letterSpacing: -0.5 },
  brandTagline: { fontSize: 14, fontFamily: 'SairaSemiCondensed-Regular', color: 'rgba(255,255,255,0.7)', marginTop: 4 },
  features: { gap: 16 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  featureIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  featureInfo: { flex: 1 },
  featureLabel: { fontSize: 14, fontFamily: 'SairaSemiCondensed-SemiBold', color: '#fff' },
  featureSub: { fontSize: 11, fontFamily: 'SairaSemiCondensed-Regular', color: 'rgba(255,255,255,0.6)', marginTop: 1 },
  bottomCta: { alignItems: 'center', gap: 14 },
  signInBtnWrap: { width: '100%', borderRadius: 20, overflow: 'hidden', ...shadows.lg },
  signInBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#fff', paddingVertical: 16, borderRadius: 20 },
  signInText: { fontSize: 16, fontFamily: 'SairaSemiCondensed-Bold', color: colors.brandDark },
  forgotText: { fontSize: 13, fontFamily: 'SairaSemiCondensed-Medium', color: 'rgba(255,255,255,0.8)', textDecorationLine: 'underline' },
  versionText: { fontSize: 10, fontFamily: 'SairaSemiCondensed-Regular', color: 'rgba(255,255,255,0.4)', marginTop: 6 },
});
