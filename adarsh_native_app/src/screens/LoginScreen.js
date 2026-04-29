import React, { useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, Alert, ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { FontAwesome5 } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import Toast from '../components/Toast';
import { colors, gradients, typography, spacing, radius, shadows } from '../theme';

export default function LoginScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { login } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState({ visible: false, message: '', type: 'error' });
  const passwordRef = useRef(null);

  const handleLogin = async () => {
    setError('');
    if (!email.trim() || !password) {
      setError('Please enter your email and password.');
      return;
    }

    setLoading(true);
    try {
      const result = await login(email.trim(), password);

      if (!result.success) {
        const data = result.data;

        if (data.session_limit_hit && data.can_force_logout_other) {
          const devices = (data.active_session_devices || [])
            .slice(0, 3)
            .map(d => {
              const label = (d.device_label || 'Unknown device').trim();
              const ip = (d.ip_address || '').trim();
              return ip ? `${label} [${ip}]` : label;
            })
            .join(', ');
          const msg = devices
            ? `Already logged in on: ${devices}. Logout other device and continue here?`
            : 'Already logged in on another mobile. Logout other device and continue here?';

          Alert.alert('Session Limit', msg, [
            { text: 'Cancel', style: 'cancel', onPress: () => setLoading(false) },
            {
              text: 'Logout Other',
              style: 'destructive',
              onPress: async () => {
                const retry = await login(email.trim(), password, true);
                if (!retry.success) {
                  setError(retry.data?.message || 'Login failed.');
                }
                setLoading(false);
              },
            },
          ]);
          return;
        }

        if (data.no_mobile_access) {
          setError('Mobile app access has not been enabled for your account.');
          setLoading(false);
          return;
        }

        setError(data.message || 'Invalid email or password.');
      }
    } catch (e) {
      setError('Network error — please try again.');
    }
    setLoading(false);
  };

  return (
    <LinearGradient
      colors={gradients.brandFull}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.root}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top }]}
          keyboardShouldPersistTaps="handled"
          bounces={false}
        >
          {/* Decorative Elements */}
          <View style={[styles.bubble, styles.bubble1]} />
          <View style={[styles.bubble, styles.bubble2]} />

          <View style={styles.brandSection}>
            <View style={styles.appIcon}>
              <FontAwesome5 name="id-card" size={40} color={colors.white} solid />
            </View>
            <Text style={styles.brandTitle}>ADARSH</Text>
            <Text style={styles.brandSubtitle}>Management Portal</Text>
          </View>

          <View style={[styles.card, { paddingBottom: insets.bottom + 40 }]}>
            <Text style={styles.cardTitle}>Welcome back</Text>
            <Text style={styles.cardSubtitle}>Sign in to your account</Text>

            {!!error && (
              <View style={styles.errorBar}>
                <FontAwesome5 name="exclamation-circle" size={14} color={colors.error} solid />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <View style={styles.fieldWrap}>
              <Text style={styles.label}>EMAIL ADDRESS</Text>
              <View style={styles.inputWrap}>
                <FontAwesome5 name="envelope" size={14} color={colors.gray400} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="you@example.com"
                  placeholderTextColor={colors.gray400}
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  returnKeyType="next"
                  onSubmitEditing={() => passwordRef.current?.focus()}
                />
              </View>
            </View>

            <View style={styles.fieldWrap}>
              <Text style={styles.label}>PASSWORD</Text>
              <View style={styles.inputWrap}>
                <FontAwesome5 name="lock" size={14} color={colors.gray400} style={styles.inputIcon} />
                <TextInput
                  ref={passwordRef}
                  style={[styles.input, { paddingRight: 50 }]}
                  placeholder="••••••••"
                  placeholderTextColor={colors.gray400}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  returnKeyType="go"
                  onSubmitEditing={handleLogin}
                />
                <TouchableOpacity
                  onPress={() => setShowPassword(!showPassword)}
                  style={styles.eyeBtn}
                >
                  <FontAwesome5 name={showPassword ? 'eye-slash' : 'eye'} size={14} color={colors.gray400} />
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity
              onPress={handleLogin}
              disabled={loading}
              activeOpacity={0.9}
              style={styles.submitBtnWrap}
            >
              <LinearGradient
                colors={gradients.brand}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.submitBtn}
              >
                {loading ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.submitText}>Sign In Now</Text>}
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => navigation.navigate('ForgotPassword')} style={styles.forgotLink}>
              <Text style={styles.forgotLinkText}>Forgot your password?</Text>
            </TouchableOpacity>

            <View style={styles.helpBox}>
              <Text style={styles.helpText}>Need help? Contact support</Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <Toast visible={toast.visible} message={toast.message} type={toast.type} onHide={() => setToast(p => ({ ...p, visible: false }))} />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'flex-end' },
  bubble: { position: 'absolute', borderRadius: 100, backgroundColor: 'rgba(255,255,255,0.1)' },
  bubble1: { width: 300, height: 300, top: -100, right: -100 },
  bubble2: { width: 200, height: 200, bottom: 200, left: -50 },
  brandSection: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
  appIcon: { width: 100, height: 100, borderRadius: 32, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', ...shadows.xl },
  brandTitle: { color: '#fff', fontSize: 32, fontWeight: '900', fontFamily: 'SairaSemiCondensed-Bold', letterSpacing: 4, marginTop: 24 },
  brandSubtitle: { color: 'rgba(255,255,255,0.8)', fontSize: 16, fontFamily: 'SairaSemiCondensed-Medium', marginTop: 4 },
  card: { backgroundColor: '#fff', borderTopLeftRadius: 40, borderTopRightRadius: 40, paddingHorizontal: 32, paddingTop: 40, ...shadows.xl },
  cardTitle: { fontSize: 28, fontWeight: '800', color: colors.gray800, fontFamily: 'SairaSemiCondensed-Bold' },
  cardSubtitle: { fontSize: 15, color: colors.gray400, marginTop: 4, marginBottom: 32, fontFamily: 'SairaSemiCondensed-Medium' },
  errorBar: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff1f2', padding: 16, borderRadius: 16, marginBottom: 24, borderWidth: 1, borderColor: '#ffe4e6' },
  errorText: { flex: 1, color: '#e11d48', fontSize: 13, fontFamily: 'SairaSemiCondensed-Medium' },
  fieldWrap: { marginBottom: 20 },
  label: { fontSize: 11, fontWeight: '800', color: colors.gray400, letterSpacing: 1.5, marginBottom: 8, fontFamily: 'SairaSemiCondensed-Bold' },
  inputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8fafc', borderRadius: 16, borderWidth: 1, borderColor: '#f1f5f9' },
  inputIcon: { marginLeft: 16 },
  input: { flex: 1, paddingHorizontal: 12, paddingVertical: 16, fontSize: 15, color: colors.gray800, fontFamily: 'SairaSemiCondensed-Medium' },
  eyeBtn: { padding: 16 },
  submitBtnWrap: { marginTop: 12, borderRadius: 16, overflow: 'hidden', ...shadows.lg },
  submitBtn: { paddingVertical: 18, alignItems: 'center', justifyContent: 'center' },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '800', fontFamily: 'SairaSemiCondensed-Bold' },
  forgotLink: { alignSelf: 'center', marginTop: 24 },
  forgotLinkText: { color: colors.brandPrimary, fontSize: 14, fontWeight: '700', fontFamily: 'SairaSemiCondensed-Bold' },
  helpBox: { marginTop: 32, alignItems: 'center' },
  helpText: { fontSize: 13, color: colors.gray400, fontFamily: 'SairaSemiCondensed-Medium' },
});
