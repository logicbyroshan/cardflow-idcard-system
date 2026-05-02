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

        // Session limit — offer force logout
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

        // No mobile access
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
      colors={['#667eea', '#764ba2', '#5b21b6']}
      start={{ x: 0.3, y: 0 }}
      end={{ x: 0.7, y: 1 }}
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
          {/* Background decorative elements */}
          <View style={[styles.bubble, styles.bubble1]} />
          <View style={[styles.bubble, styles.bubble2]} />
          <View style={[styles.bubble, styles.bubble3]} />

          {/* Top branding */}
          <View style={styles.brandSection}>
            <View style={styles.appIcon}>
              <FontAwesome5 name="id-card" size={30} color={colors.white} solid />
            </View>
            <Text style={styles.brandTitle}>Adarsh ID Cards</Text>
            <Text style={styles.brandSubtitle}>Management Portal</Text>
          </View>

          {/* Login Card */}
          <View style={[styles.card, { paddingBottom: insets.bottom + 28 }]}>
            <Text style={styles.cardTitle}>Welcome back</Text>
            <Text style={styles.cardSubtitle}>Sign in to continue</Text>

            {/* Error bar */}
            {!!error && (
              <View style={styles.errorBar}>
                <FontAwesome5 name="exclamation-circle" size={14} color={colors.error} solid />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {/* Email */}
            <View style={styles.fieldWrap}>
              <Text style={styles.label}>EMAIL</Text>
              <View style={styles.inputWrap}>
                <FontAwesome5 name="envelope" size={14} color={colors.gray400} solid style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="you@example.com"
                  placeholderTextColor={colors.gray300}
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoComplete="email"
                  returnKeyType="next"
                  onSubmitEditing={() => passwordRef.current?.focus()}
                />
              </View>
            </View>

            {/* Password */}
            <View style={styles.fieldWrap}>
              <Text style={styles.label}>PASSWORD</Text>
              <View style={styles.inputWrap}>
                <FontAwesome5 name="lock" size={14} color={colors.gray400} solid style={styles.inputIcon} />
                <TextInput
                  ref={passwordRef}
                  style={[styles.input, { paddingRight: 48 }]}
                  placeholder="••••••"
                  placeholderTextColor={colors.gray300}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoComplete="current-password"
                  returnKeyType="go"
                  onSubmitEditing={handleLogin}
                />
                <TouchableOpacity
                  onPress={() => setShowPassword(!showPassword)}
                  style={styles.eyeBtn}
                  activeOpacity={0.6}
                >
                  <FontAwesome5
                    name={showPassword ? 'eye-slash' : 'eye'}
                    size={14}
                    color={colors.gray400}
                    solid
                  />
                </TouchableOpacity>
              </View>
            </View>

            {/* Submit */}
            <TouchableOpacity
              onPress={handleLogin}
              disabled={loading}
              activeOpacity={0.85}
              style={styles.submitBtn}
            >
              <LinearGradient
                colors={gradients.brandFull}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.submitGradient}
              >
                {loading && <ActivityIndicator size="small" color={colors.white} />}
                <Text style={styles.submitText}>
                  {loading ? 'Signing in...' : 'Sign In'}
                </Text>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => navigation.navigate('ForgotPassword')} activeOpacity={0.7} style={styles.forgotLink}>
              <Text style={styles.forgotLinkText}>Forgot Password?</Text>
            </TouchableOpacity>

            <Text style={styles.helpText}>
              Having trouble? Contact your administrator
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <Toast
        visible={toast.visible}
        message={toast.message}
        type={toast.type}
        onHide={() => setToast(prev => ({ ...prev, visible: false }))}
      />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'flex-end',
  },

  // Decorative bubbles
  bubble: {
    position: 'absolute',
    borderRadius: radius.sm,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  bubble1: { width: 220, height: 220, top: -60, right: -60 },
  bubble2: { width: 140, height: 140, bottom: 180, left: -50 },
  bubble3: { width: 80, height: 80, top: '40%', right: 20 },

  // Brand section
  brandSection: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 24,
    paddingHorizontal: 32,
  },
  appIcon: {
    width: 80,
    height: 80,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    ...shadows.xl,
  },
  brandTitle: {
    color: colors.white,
    fontSize: typography.title,
    fontFamily: 'SairaSemiCondensed-Bold',
    letterSpacing: -0.5,
  },
  brandSubtitle: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: typography.lg,
    fontFamily: 'SairaSemiCondensed-Regular',
    marginTop: 4,
  },

  // Login card
  card: {
    backgroundColor: colors.glassBg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: 28,
    paddingHorizontal: 24,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    borderBottomWidth: 0,
    ...shadows.xl,
  },
  cardTitle: {
    color: colors.gray800,
    fontSize: typography.xxxl,
    fontWeight: '700',
    marginBottom: 4,
  },
  cardSubtitle: {
    color: colors.gray400,
    fontSize: typography.lg,
    marginBottom: 24,
  },

  // Error
  errorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.errorBg,
    borderWidth: 1,
    borderColor: colors.errorBorder,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.lg,
  },
  errorText: {
    flex: 1,
    color: colors.error,
    fontSize: typography.lg,
  },

  // Form fields
  fieldWrap: {
    marginBottom: spacing.lg,
  },
  label: {
    fontSize: typography.xs,
    fontWeight: typography.semibold,
    color: colors.gray500,
    letterSpacing: 1,
    marginBottom: 6,
  },
  inputWrap: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
  },
  inputIcon: {
    position: 'absolute',
    left: 14,
    zIndex: 1,
  },
  input: {
    flex: 1,
    backgroundColor: colors.gray50,
    borderWidth: 1,
    borderColor: colors.gray200,
    borderRadius: radius.md,
    paddingLeft: 40,
    paddingRight: 16,
    paddingVertical: 14,
    fontSize: typography.base,
    color: colors.gray800,
  },
  eyeBtn: {
    position: 'absolute',
    right: 14,
    padding: 4,
  },

  // Submit button
  submitBtn: {
    marginTop: 8,
    borderRadius: radius.md,
    overflow: 'hidden',
    ...shadows.lg,
  },
  submitGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: 16,
    borderRadius: radius.md,
  },
  submitText: {
    color: colors.white,
    fontSize: typography.xl,
    fontWeight: typography.bold,
  },

  helpText: {
    textAlign: 'center',
    color: colors.gray400,
    fontSize: typography.md,
    fontFamily: 'SairaSemiCondensed-Regular',
    marginTop: 12,
  },
  forgotLink: {
    alignSelf: 'center',
    marginTop: 16,
    paddingVertical: 6,
  },
  forgotLinkText: {
    color: colors.brandDark,
    fontSize: typography.lg,
    fontFamily: 'SairaSemiCondensed-SemiBold',
    textDecorationLine: 'underline',
  },
});
