import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, AppState } from 'react-native';
import { DynamicIcon } from './Icons';
import { LinearGradient } from 'expo-linear-gradient';
import NetInfo from '@react-native-community/netinfo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, gradients, fontFamily, typography, radius, shadows } from '../theme';

/**
 * Global network monitor + error boundary wrapper.
 * Shows a full-screen offline overlay when connectivity is lost.
 * Usage:  <NetworkGuard>{children}</NetworkGuard>
 */
export default function NetworkGuard({ children }) {
  const [isOnline, setIsOnline] = useState(true);
  const [wasOffline, setWasOffline] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      const online = state.isConnected && state.isInternetReachable !== false;
      setIsOnline(online);
      if (!online) setWasOffline(true);
    });
    return () => unsubscribe();
  }, []);

  // Reconnected banner fade
  useEffect(() => {
    if (isOnline && wasOffline) {
      fadeAnim.setValue(1);
      const timer = setTimeout(() => {
        Animated.timing(fadeAnim, { toValue: 0, duration: 600, useNativeDriver: true }).start(() => setWasOffline(false));
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [isOnline, wasOffline, fadeAnim]);

  return (
    <View style={{ flex: 1 }}>
      {children}
      {!isOnline && <OfflineOverlay />}
      {isOnline && wasOffline && (
        <Animated.View style={[styles.reconnected, { opacity: fadeAnim }]}>
          <DynamicIcon name="wifi" size={11} color="#fff" />
          <Text style={styles.reconnectedText}>Back online</Text>
        </Animated.View>
      )}
    </View>
  );
}

/** Full-screen offline overlay */
function OfflineOverlay() {
  const insets = useSafeAreaInsets();
  const pulseAnim = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 1200, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.6, duration: 1200, useNativeDriver: true }),
      ])
    ).start();
  }, [pulseAnim]);

  return (
    <View style={[styles.overlay, { paddingTop: insets.top + 20 }]}>
      <LinearGradient colors={['#1e1e2e', '#2d1f3d']} style={styles.overlayGradient}>
        <View style={styles.overlayContent}>
          <Animated.View style={[styles.iconCircle, { opacity: pulseAnim }]}>
            <DynamicIcon name="wifi" size={32} color="#ef4444" />
            <View style={styles.slash} />
          </Animated.View>
          <Text style={styles.overlayTitle}>No Internet Connection</Text>
          <Text style={styles.overlayMessage}>
            Please check your Wi-Fi or mobile data and try again. The app will reconnect automatically.
          </Text>
          <View style={styles.tipCard}>
            <DynamicIcon name="lightbulb" size={12} color="#f59e0b" />
            <Text style={styles.tipText}>Make sure airplane mode is off and you have signal</Text>
          </View>
        </View>
      </LinearGradient>
    </View>
  );
}

// ─── Reusable Error Screens ────────────────────────────────────────────────

export const ERROR_TYPES = {
  NETWORK: 'network',
  SERVER: 'server',
  NOT_FOUND: 'not_found',
  PERMISSION: 'permission',
  SESSION: 'session',
  TIMEOUT: 'timeout',
  GENERIC: 'generic',
};

const ERROR_CONFIG = {
  [ERROR_TYPES.NETWORK]: {
    icon: 'wifi',
    iconColor: '#ef4444',
    title: 'Connection Error',
    message: 'Unable to reach the server. Please check your internet connection and try again.',
    actionLabel: 'Retry',
    actionIcon: 'redo',
    gradientColors: ['#dc2626', '#ef4444'],
    bgTint: '#fef2f2',
    borderColor: '#fecaca',
  },
  [ERROR_TYPES.SERVER]: {
    icon: 'server',
    iconColor: '#f59e0b',
    title: 'Server Error',
    message: 'Something went wrong on our end. Our team has been notified. Please try again shortly.',
    actionLabel: 'Try Again',
    actionIcon: 'redo',
    gradientColors: ['#d97706', '#f59e0b'],
    bgTint: '#fffbeb',
    borderColor: '#fde68a',
  },
  [ERROR_TYPES.NOT_FOUND]: {
    icon: 'search',
    iconColor: '#3b82f6',
    title: 'Not Found',
    message: 'The page or resource you\'re looking for doesn\'t exist or has been moved.',
    actionLabel: 'Go Home',
    actionIcon: 'home',
    gradientColors: ['#2563eb', '#3b82f6'],
    bgTint: '#eff6ff',
    borderColor: '#bfdbfe',
  },
  [ERROR_TYPES.PERMISSION]: {
    icon: 'lock',
    iconColor: '#8b5cf6',
    title: 'Access Denied',
    message: 'You don\'t have permission to access this resource. Contact your administrator.',
    actionLabel: 'Go Back',
    actionIcon: 'arrow-left',
    gradientColors: ['#7c3aed', '#8b5cf6'],
    bgTint: '#f5f3ff',
    borderColor: '#ddd6fe',
  },
  [ERROR_TYPES.SESSION]: {
    icon: 'user-clock',
    iconColor: '#667eea',
    title: 'Session Expired',
    message: 'Your session has expired. Please sign in again to continue.',
    actionLabel: 'Sign In',
    actionIcon: 'sign-in-alt',
    gradientColors: colors.brandPrimary ? [colors.brandPrimary, colors.brandSecondary] : ['#667eea', '#764ba2'],
    bgTint: '#eef2ff',
    borderColor: '#c7d2fe',
  },
  [ERROR_TYPES.TIMEOUT]: {
    icon: 'hourglass-half',
    iconColor: '#f59e0b',
    title: 'Request Timeout',
    message: 'The server took too long to respond. This may be due to slow connectivity.',
    actionLabel: 'Retry',
    actionIcon: 'redo',
    gradientColors: ['#d97706', '#f59e0b'],
    bgTint: '#fffbeb',
    borderColor: '#fde68a',
  },
  [ERROR_TYPES.GENERIC]: {
    icon: 'exclamation-triangle',
    iconColor: '#ef4444',
    title: 'Something Went Wrong',
    message: 'An unexpected error occurred. Please try again.',
    actionLabel: 'Retry',
    actionIcon: 'redo',
    gradientColors: ['#dc2626', '#ef4444'],
    bgTint: '#fef2f2',
    borderColor: '#fecaca',
  },
};

/**
 * Inline error view for use inside screens.
 * Usage:
 *   <ErrorView type={ERROR_TYPES.NETWORK} onRetry={reload} />
 *   <ErrorView type={ERROR_TYPES.SERVER} message="Custom message" onRetry={fn} />
 */
export function ErrorView({ type = ERROR_TYPES.GENERIC, message, onRetry, onGoBack, onGoHome }) {
  const config = ERROR_CONFIG[type] || ERROR_CONFIG[ERROR_TYPES.GENERIC];
  const displayMessage = message || config.message;

  return (
    <View style={ev.root}>
      <View style={[ev.iconWrap, { backgroundColor: config.bgTint, borderColor: config.borderColor }]}>
        <DynamicIcon name={config.icon} size={28} color={config.iconColor} />
      </View>
      <Text style={ev.title}>{config.title}</Text>
      <Text style={ev.message}>{displayMessage}</Text>

      <View style={ev.actions}>
        {onRetry && (
          <TouchableOpacity onPress={onRetry} activeOpacity={0.85} style={ev.btnWrap}>
            <LinearGradient colors={config.gradientColors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={ev.btn}>
              <DynamicIcon name={config.actionIcon} size={12} color="#fff" />
              <Text style={ev.btnText}>{config.actionLabel}</Text>
            </LinearGradient>
          </TouchableOpacity>
        )}
        {onGoHome && (
          <TouchableOpacity onPress={onGoHome} activeOpacity={0.85} style={ev.secondaryBtnWrap}>
            <DynamicIcon name="home" size={12} color={colors.gray600} />
            <Text style={ev.secondaryBtnText}>Go Home</Text>
          </TouchableOpacity>
        )}
        {onGoBack && (
          <TouchableOpacity onPress={onGoBack} activeOpacity={0.85} style={ev.secondaryBtnWrap}>
            <DynamicIcon name="arrow-left" size={12} color={colors.gray600} />
            <Text style={ev.secondaryBtnText}>Go Back</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

/**
 * Small inline error banner for API errors within screens.
 * Usage:
 *   {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
 */
export function ErrorBanner({ message, type = 'error', onDismiss, onRetry }) {
  const isWarning = type === 'warning';
  const bg = isWarning ? '#fffbeb' : '#fef2f2';
  const border = isWarning ? '#fde68a' : '#fecaca';
  const textColor = isWarning ? '#92400e' : '#991b1b';
  const icon = isWarning ? 'exclamation-circle' : 'times-circle';
  const iconColor = isWarning ? '#f59e0b' : '#ef4444';

  return (
    <View style={[eb.root, { backgroundColor: bg, borderColor: border }]}>
      <DynamicIcon name={icon} size={14} color={iconColor} />
      <Text style={[eb.text, { color: textColor }]} numberOfLines={3}>{message}</Text>
      {onRetry && (
        <TouchableOpacity onPress={onRetry} style={eb.retryBtn}>
          <DynamicIcon name="redo" size={10} color={textColor} />
        </TouchableOpacity>
      )}
      {onDismiss && (
        <TouchableOpacity onPress={onDismiss} style={eb.dismissBtn}>
          <DynamicIcon name="times" size={10} color={textColor} />
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 9999,
  },
  overlayGradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  overlayContent: {
    alignItems: 'center',
    maxWidth: 320,
  },
  iconCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(239,68,68,0.15)',
    borderWidth: 2,
    borderColor: 'rgba(239,68,68,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  slash: {
    position: 'absolute',
    width: 50,
    height: 3,
    backgroundColor: '#ef4444',
    borderRadius: 2,
    transform: [{ rotate: '45deg' }],
  },
  overlayTitle: {
    fontSize: 22,
    fontFamily: 'SairaSemiCondensed-Bold',
    color: '#fff',
    marginBottom: 10,
    textAlign: 'center',
  },
  overlayMessage: {
    fontSize: 14,
    fontFamily: 'SairaSemiCondensed-Regular',
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  tipCard: {
    flexDirection: 'row',
    alignItems: 'center',
    
    backgroundColor: 'rgba(245,158,11,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.2)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  tipText: {
    flex: 1,
    fontSize: 12,
    fontFamily: 'SairaSemiCondensed-Regular',
    color: 'rgba(255,255,255,0.5)',
    lineHeight: 16,
  },
  reconnected: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    
    backgroundColor: '#22c55e',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    ...shadows.md,
  },
  reconnectedText: {
    fontSize: 12,
    fontFamily: 'SairaSemiCondensed-SemiBold',
    color: '#fff',
  },
});

const ev = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingBottom: 40,
  },
  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 24,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    ...shadows.sm,
  },
  title: {
    fontSize: 20,
    fontFamily: 'SairaSemiCondensed-Bold',
    color: colors.gray800,
    marginBottom: 8,
    textAlign: 'center',
  },
  message: {
    fontSize: 14,
    fontFamily: 'SairaSemiCondensed-Regular',
    color: colors.gray500,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
    paddingHorizontal: 8,
  },
  actions: {
    alignItems: 'center',
    
  },
  btnWrap: {
    borderRadius: 16,
    overflow: 'hidden',
    ...shadows.md,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 16,
  },
  btnText: {
    color: '#fff',
    fontSize: 14,
    fontFamily: 'SairaSemiCondensed-SemiBold',
  },
  secondaryBtnWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: colors.gray100,
    borderRadius: 12,
  },
  secondaryBtnText: {
    fontSize: 13,
    fontFamily: 'SairaSemiCondensed-Medium',
    color: colors.gray600,
  },
});

const eb = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginVertical: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderRadius: 12,
  },
  text: {
    flex: 1,
    fontSize: 12,
    fontFamily: 'SairaSemiCondensed-Regular',
    lineHeight: 16,
  },
  retryBtn: {
    padding: 6,
  },
  dismissBtn: {
    padding: 6,
  },
});
