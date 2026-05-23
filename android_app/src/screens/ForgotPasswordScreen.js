import React, { useState, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { DynamicIcon } from '../components/Icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from '../components/Toast';
import Button from '../components/Button';
import Input from '../components/Input';
import { apiPost, fetchInitialCsrf } from '../api/client';
import { colors, gradients, shadows, radius, fontFamily } from '../theme';

const STEPS = { EMAIL: 'email', OTP: 'otp', RESET: 'reset', DONE: 'done' };

export default function ForgotPasswordScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(STEPS.EMAIL);
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });
  const showToast = (msg, type = 'info') => setToast({ visible: true, message: msg, type });

  const handleSendOtp = async () => {
    if (!email.trim()) { setError('Please enter your email.'); return; }
    setError(''); setLoading(true);
    try {
      await fetchInitialCsrf();
      const { data } = await apiPost('/panel/api/auth/forgot-password/', { email: email.trim() });
      if (data?.success) { showToast(data.message || 'OTP sent!', 'success'); setStep(STEPS.OTP); }
      else setError(data?.message || 'Failed to send OTP.');
    } catch (e) { setError('Network error.'); }
    setLoading(false);
  };

  const handleVerifyOtp = async () => {
    if (!otp.trim()) { setError('Please enter the OTP.'); return; }
    setError(''); setLoading(true);
    try {
      const { data } = await apiPost('/panel/api/auth/verify-otp/', { email: email.trim(), otp: otp.trim() });
      if (data?.success) {
        setResetToken(data.reset_token || '');
        showToast('OTP verified!', 'success');
        setStep(STEPS.RESET);
      } else setError(data?.message || 'Invalid OTP.');
    } catch (e) { setError('Network error.'); }
    setLoading(false);
  };

  const handleResetPassword = async () => {
    if (!newPassword || !confirmPassword) { setError('Please fill in both fields.'); return; }
    if (newPassword.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (newPassword !== confirmPassword) { setError('Passwords do not match.'); return; }
    setError(''); setLoading(true);
    try {
      const { data } = await apiPost('/panel/api/auth/reset-password/', { email: email.trim(), reset_token: resetToken, new_password: newPassword, confirm_password: confirmPassword });
      if (data?.success) { showToast('Password reset successful!', 'success'); setStep(STEPS.DONE); }
      else setError(data?.message || 'Failed to reset password.');
    } catch (e) { setError('Network error.'); }
    setLoading(false);
  };

  const stepConfig = {
    [STEPS.EMAIL]: { icon: 'envelope', title: 'Forgot Password', subtitle: 'Enter your email to receive an OTP' },
    [STEPS.OTP]: { icon: 'key', title: 'Verify OTP', subtitle: `We sent a code to ${email}` },
    [STEPS.RESET]: { icon: 'lock', title: 'New Password', subtitle: 'Create a strong new password' },
    [STEPS.DONE]: { icon: 'check-circle', title: 'All Done!', subtitle: 'Your password has been reset' },
  };
  const cfg = stepConfig[step];

  return (
    <LinearGradient colors={['#667eea', '#764ba2', '#5b21b6']} start={{ x: 0.3, y: 0 }} end={{ x: 0.7, y: 1 }} style={s.root}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={[s.scroll, { paddingTop: insets.top }]} keyboardShouldPersistTaps="handled" bounces={false}>
          {/* Back */}
          <TouchableOpacity onPress={() => step === STEPS.EMAIL || step === STEPS.DONE ? navigation.goBack() : setStep(step === STEPS.RESET ? STEPS.OTP : STEPS.EMAIL)} style={s.backBtn} activeOpacity={0.7}>
            <DynamicIcon name="arrow-left" size={14} color="#fff" />
          </TouchableOpacity>

          {/* Header */}
          <View style={s.header}>
            <View style={s.headerIcon}><DynamicIcon name={cfg.icon} size={28} color="#fff" /></View>
            <Text style={s.headerTitle}>{cfg.title}</Text>
            <Text style={s.headerSub}>{cfg.subtitle}</Text>
            {/* Step Indicator */}
            <View style={s.stepRow}>
              {[STEPS.EMAIL, STEPS.OTP, STEPS.RESET].map((st, i) => (
                <View key={st} style={[s.stepDot, step === st && s.stepDotActive, Object.values(STEPS).indexOf(step) > i && s.stepDotDone]} />
              ))}
            </View>
          </View>

          {/* Card */}
          <View style={[s.card, { paddingBottom: insets.bottom + 28 }]}>
            {!!error && (
              <View style={s.errorBar}><DynamicIcon name="exclamation-circle" size={13} color="#ef4444" /><Text style={s.errorText}>{error}</Text></View>
            )}

            {step === STEPS.EMAIL && (
              <>
                <Input label="EMAIL ADDRESS" leftIcon="envelope" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" returnKeyType="go" onSubmitEditing={handleSendOtp} />
                <Button variant="primary" fullWidth loading={loading} onPress={handleSendOtp} style={s.ctaBtnWrap}>
                  Send OTP
                </Button>
              </>
            )}

            {step === STEPS.OTP && (
              <>
                <Input label="ENTER OTP" leftIcon="key" value={otp} onChangeText={setOtp} placeholder="Enter 6-digit code" keyboardType="number-pad" maxLength={6} returnKeyType="go" onSubmitEditing={handleVerifyOtp} />
                <Button variant="primary" fullWidth loading={loading} onPress={handleVerifyOtp} style={s.ctaBtnWrap}>
                  Verify OTP
                </Button>
                <Button variant="ghost" onPress={handleSendOtp} style={s.resendBtn} textStyle={s.resendText}>
                  Resend OTP
                </Button>
              </>
            )}

            {step === STEPS.RESET && (
              <>
                <Input label="NEW PASSWORD" leftIcon="lock" value={newPassword} onChangeText={setNewPassword} placeholder="Min. 8 characters" secureTextEntry />
                <Input label="CONFIRM PASSWORD" leftIcon="lock" value={confirmPassword} onChangeText={setConfirmPassword} placeholder="Re-enter password" secureTextEntry returnKeyType="go" onSubmitEditing={handleResetPassword} />
                <Button variant="primary" fullWidth loading={loading} onPress={handleResetPassword} style={s.ctaBtnWrap}>
                  Reset Password
                </Button>
              </>
            )}

            {step === STEPS.DONE && (
              <View style={s.doneSection}>
                <View style={s.doneBadge}><DynamicIcon name="check" size={24} color="#22c55e" /></View>
                <Text style={s.doneTitle}>Password Reset Successful</Text>
                <Text style={s.doneSub}>You can now sign in with your new password.</Text>
                <Button variant="primary" fullWidth onPress={() => navigation.navigate('Login')} style={s.ctaBtnWrap}>
                  Go to Sign In
                </Button>
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <Toast visible={toast.visible} message={toast.message} type={toast.type} onHide={() => setToast(p => ({ ...p, visible: false }))} />
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'flex-end' },
  backBtn: { position: 'absolute', top: 16, left: 16, width: 40, height: 40, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', zIndex: 10 },
  header: { alignItems: 'center', paddingBottom: 24, paddingHorizontal: 32 },
  headerIcon: { width: 72, height: 72, borderRadius: radius.xl, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', marginBottom: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', ...shadows.lg },
  headerTitle: { fontSize: 22, fontFamily: 'SairaSemiCondensed-Bold', color: '#fff' },
  headerSub: { fontSize: 13, fontFamily: 'SairaSemiCondensed-Regular', color: 'rgba(255,255,255,0.7)', marginTop: 4, textAlign: 'center' },
  stepRow: { flexDirection: 'row', marginTop: 16 },
  stepDot: { width: 32, height: 4, borderRadius: radius.xs, backgroundColor: 'rgba(255,255,255,0.25)' },
  stepDotActive: { backgroundColor: '#fff', width: 48 },
  stepDotDone: { backgroundColor: 'rgba(255,255,255,0.6)' },
  card: { backgroundColor: 'rgba(255,255,255,0.97)', borderTopLeftRadius: radius.xxl * 2, borderTopRightRadius: radius.xxl * 2, paddingTop: 24, paddingHorizontal: 24, borderWidth: 1, borderColor: 'rgba(214,231,248,0.96)', borderBottomWidth: 0, ...shadows.xl },
  errorBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca', borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 14 },
  errorText: { flex: 1, color: '#ef4444', fontSize: 13, fontFamily: 'SairaSemiCondensed-Medium' },
  label: { fontSize: 10, fontFamily: 'SairaSemiCondensed-SemiBold', color: colors.gray500, letterSpacing: 1, marginBottom: 6 },
  inputWrap: { position: 'relative', flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  inputIcon: { position: 'absolute', left: 14, zIndex: 1 },
  input: { flex: 1, backgroundColor: colors.gray50, borderWidth: 1, borderColor: colors.gray200, borderRadius: radius.md, paddingLeft: 40, paddingRight: 16, paddingVertical: 14, fontSize: 14, fontFamily: 'SairaSemiCondensed-Regular', color: colors.gray800 },
  ctaBtnWrap: { marginTop: 12, borderRadius: radius.xl, overflow: 'hidden', ...shadows.lg },
  resendBtn: { marginTop: 4, alignSelf: 'center' },
  resendText: { color: colors.brandLight, textDecorationLine: 'underline' },
  doneSection: { alignItems: 'center', paddingVertical: 20 },
  doneBadge: { width: 72, height: 72, borderRadius: radius.sm, backgroundColor: '#d1fae5', alignItems: 'center', justifyContent: 'center', marginBottom: 16, borderWidth: 2, borderColor: '#a7f3d0' },
  doneTitle: { fontSize: 18, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray800, marginBottom: 6 },
  doneSub: { fontSize: 13, fontFamily: 'SairaSemiCondensed-Regular', color: colors.gray400, textAlign: 'center', marginBottom: 20 },
});
