import React, { useState, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { DynamicIcon } from '../components/Icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import Toast from '../components/Toast';
import Button from '../components/Button';
import Input from '../components/Input';
import { colors, gradients, typography, spacing, radius, shadows, fontFamily } from '../theme';

export default function LoginScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { login } = useAuth();
  const passwordInputRef = useRef(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState({ visible: false, message: '', type: 'error' });
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
                } else {
                  navigation.reset({
                    index: 0,
                    routes: [{ name: 'Home' }],
                  });
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
      } else {
        const hasMpin = await AsyncStorage.getItem(`adarsh_mpin_${email.trim().toLowerCase()}`);
        navigation.reset({
          index: 0,
          routes: [{ name: hasMpin ? 'Home' : 'Mpin' }],
        });
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
              <DynamicIcon name="id-card" size={30} color={colors.white} />
            </View>
            <Text style={styles.brandTitle}>Adarsh ID Cards</Text>
            <Text style={styles.brandSubtitle}>Management Portal</Text>
          </View>

          {/* Login Card */}
          <View style={[styles.card, { paddingBottom: Math.max(insets.bottom, 20) + 28 }]}>
            <Text style={styles.cardTitle}>Welcome back</Text>
            <Text style={styles.cardSubtitle}>Sign in to continue</Text>

            {/* Error bar */}
            {!!error && (
              <View style={styles.errorBar}>
                <DynamicIcon name="exclamation-circle" size={14} color={colors.error} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {/* Email */}
            <Input
              label="EMAIL"
              leftIcon="envelope"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              returnKeyType="next"
              onSubmitEditing={() => passwordInputRef.current?.focus()}
            />

            {/* Password */}
            <Input
              ref={passwordInputRef}
              label="PASSWORD"
              leftIcon="lock"
              value={password}
              onChangeText={setPassword}
              placeholder="••••••"
              autoComplete="current-password"
              secureTextEntry
              returnKeyType="go"
              onSubmitEditing={handleLogin}
            />

            {/* Submit */}
            <Button
              onPress={handleLogin}
              loading={loading}
              fullWidth
              style={styles.submitBtn}
            >
              Sign In
            </Button>

            <Button
              variant="ghost"
              onPress={() => navigation.navigate('ForgotPassword')}
              style={styles.forgotLink}
              textStyle={styles.forgotLinkText}
            >
              Forgot Password?
            </Button>

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
    borderRadius: radius.sm,
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
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: 32,
    paddingHorizontal: 24,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    borderBottomWidth: 0,
    width: '100%',
    alignSelf: 'stretch',
    ...shadows.xl,
  },
  cardTitle: {
    color: colors.gray800,
    fontSize: typography.xxxl,
    fontFamily: 'SairaSemiCondensed-Bold', 
    marginBottom: 4,
  },
  cardSubtitle: {
    color: colors.gray400,
    fontSize: typography.lg,
    fontFamily: 'SairaSemiCondensed-Regular', 
    marginBottom: 24,
  },

  // Error
  errorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.errorBg,
    borderWidth: 1,
    borderColor: colors.errorBorder,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.lg,
  },
  errorText: {
    flex: 1,
    color: colors.error,
    fontSize: typography.lg,
  },

  // Submit button
  submitBtn: {
    marginTop: 12,
    borderRadius: radius.md,
    height: 50,
    ...shadows.lg,
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
  },
  forgotLinkText: {
    color: colors.brandDark,
    textDecorationLine: 'underline',
  },
});
