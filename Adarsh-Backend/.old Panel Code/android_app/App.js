import React, { useCallback, useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, StyleSheet, Animated, Image, Dimensions, Appearance, LogBox, ActivityIndicator, TouchableOpacity, BackHandler } from 'react-native';
// LogBox.ignoreAllLogs();
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, initialWindowMetrics, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import AppNavigator from './src/navigation/AppNavigator';
import NetworkGuard from './src/components/NetworkGuard';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { colors } from './src/theme';
import UpdatePromptModal from './src/components/UpdatePromptModal';

const { width, height } = Dimensions.get('window');

const navigationRef = createNavigationContainerRef();

function AppContent() {
  const { isAuthenticated, isImpersonating, user, stopImpersonation } = useAuth();
  const insets = useSafeAreaInsets();
  const [stopping, setStopping] = useState(false);
  const pulseAnim = useRef(new Animated.Value(0.6)).current;

  const prevImpersonatingRef = useRef(isImpersonating);

  useEffect(() => {
    if (prevImpersonatingRef.current && !isImpersonating && isAuthenticated) {
      if (navigationRef.isReady()) {
        navigationRef.reset({
          index: 0,
          routes: [{ name: 'ClientsList' }],
        });
      }
    }
    prevImpersonatingRef.current = isImpersonating;
  }, [isImpersonating, isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated && isImpersonating) {
      const animation = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.2,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 0.6,
            duration: 800,
            useNativeDriver: true,
          }),
        ])
      );
      animation.start();
      return () => animation.stop();
    }
  }, [pulseAnim, isAuthenticated, isImpersonating]);

  useEffect(() => {
    const handleHardwareBack = () => {
      if (navigationRef.isReady()) {
        const canGoBack = navigationRef.canGoBack();
        if (canGoBack) {
          navigationRef.goBack();
          return true; // prevent default exit behavior
        }
      }
      return false; // let default behavior (exit/minimize) handle it
    };

    BackHandler.addEventListener('hardwareBackPress', handleHardwareBack);
    return () => {
      BackHandler.removeEventListener('hardwareBackPress', handleHardwareBack);
    };
  }, []);

  const handleStop = async () => {
    setStopping(true);
    try {
      await stopImpersonation();
    } catch (err) {
      console.log('Error stopping impersonation:', err);
    } finally {
      setStopping(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      {isAuthenticated && isImpersonating && (
        <View style={[styles.impersonateBanner, { paddingTop: insets.top }]}>
          <View style={styles.bannerContent}>
            <View style={styles.bannerTextContainer}>
              <View style={styles.pulseContainer}>
                <Animated.View 
                  style={[
                    styles.pulseOuterDot, 
                    {
                      transform: [{ scale: pulseAnim }],
                      opacity: pulseAnim.interpolate({
                        inputRange: [0.6, 1.2],
                        outputRange: [0.8, 0],
                      })
                    }
                  ]} 
                />
                <View style={styles.pulseDot} />
              </View>
              <Text style={styles.bannerText} numberOfLines={1} ellipsizeMode="tail">
                Impersonating: <Text style={styles.bannerUserText}>{user?.name || 'Client'}</Text>
              </Text>
            </View>
            <TouchableOpacity 
              style={styles.bannerButton} 
              onPress={handleStop}
              disabled={stopping}
              activeOpacity={0.8}
            >
              {stopping ? (
                <ActivityIndicator size="small" color="#ef4444" style={{ width: 32, height: 14 }} />
              ) : (
                <Text style={styles.bannerButtonText}>STOP</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}
      <NetworkGuard>
        <NavigationContainer ref={navigationRef}>
          <AppNavigator />
        </NavigationContainer>
      </NetworkGuard>
      <UpdatePromptModal />
    </View>
  );
}

export default function App() {
  const [appReady, setAppReady] = useState(false);

  const [fontsLoaded, fontError] = useFonts({
    'SairaSemiCondensed-Regular': require('./assets/fonts/SairaSemiCondensed-Regular.ttf'),
    'SairaSemiCondensed-Medium': require('./assets/fonts/SairaSemiCondensed-Medium.ttf'),
    'SairaSemiCondensed-SemiBold': require('./assets/fonts/SairaSemiCondensed-SemiBold.ttf'),
    'SairaSemiCondensed-Bold': require('./assets/fonts/SairaSemiCondensed-Bold.ttf'),
  });

  useEffect(() => {
    async function prepare() {
      try {
        Appearance.setColorScheme('light');
        await SplashScreen.preventAutoHideAsync().catch(() => {});
        // Fonts are handled by useFonts hook at the top level
      } catch (e) {
        console.warn('[App] prepare() failed', e);
      }
    }
    prepare();
  }, []);

  useEffect(() => {
    if (fontsLoaded || fontError) {
      console.log('[App] Initializing...', { fontsLoaded, fontError });
      setAppReady(true);
    }
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!appReady) {
        console.log('[App] Safety trigger: forcing appReady');
        setAppReady(true);
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [appReady]);

  useEffect(() => {
    if (appReady) {
      console.log('[App] Hiding splash screen');
      SplashScreen.hideAsync().catch(err => console.log('[App] Splash hide error:', err));
    }
  }, [appReady]);

  const onLayoutRootView = useCallback(async () => {
    // No-op, we hide in useEffect now
  }, []);

  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: colors.brandPrimary }} onLayout={onLayoutRootView}>
        <ErrorBoundary>
          {!appReady ? (
            <View style={splash.container}>
              <View style={splash.content}>
                <Image source={require('./assets/logo.png')} style={{ width: 100, height: 100 }} resizeMode="contain" />
                <Text style={splash.title}>ADARSH</Text>
                <ActivityIndicator color="#fff" style={{ marginTop: 20 }} />
              </View>
            </View>
          ) : (
            <AuthProvider>
              <StatusBar style="light" />
              <AppContent />
            </AuthProvider>
          )}
        </ErrorBoundary>
      </View>
    </SafeAreaProvider>
  );
}

// Removed AnimatedSplashScreen as it was causing hangs on some devices

const splash = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { alignItems: 'center' },
  logoGlow: {
    width: 140,
    height: 140,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  logo: { width: '100%', height: '100%' },
  title: { 
    fontSize: 32, 
    fontFamily: 'SairaSemiCondensed-Bold', 
    color: '#fff', 
    letterSpacing: 8,
    marginTop: 10
  },
  subtitle: { 
    fontSize: 12, 
    fontFamily: 'SairaSemiCondensed-Medium', 
    color: '#94a3b8', 
    letterSpacing: 3,
    textTransform: 'uppercase'
  },
  footer: { position: 'absolute', bottom: 50, alignItems: 'center', width: '100%' },
  loaderBar: {
    width: 120,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 1,
    marginBottom: 16,
    overflow: 'hidden'
  },
  loaderProgress: {
    height: '100%',
    backgroundColor: '#38bdf8',
  },
  version: { 
    fontSize: 9, 
    color: 'rgba(255,255,255,0.3)', 
    letterSpacing: 2 
  },
});

const styles = StyleSheet.create({
  impersonateBanner: {
    backgroundColor: '#ef4444',
    borderBottomWidth: 1,
    borderBottomColor: '#dc2626',
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  bannerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  bannerTextContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
  },
  pulseContainer: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
    marginRight: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#fff',
  },
  pulseOuterDot: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#ffffff',
  },
  bannerText: {
    color: '#ffffff',
    fontSize: 13,
    fontFamily: 'SairaSemiCondensed-Medium',
  },
  bannerUserText: {
    fontFamily: 'SairaSemiCondensed-Bold',
    textTransform: 'uppercase',
  },
  bannerButton: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1.41,
    elevation: 2,
  },
  bannerButtonText: {
    color: '#ef4444',
    fontSize: 11,
    fontFamily: 'SairaSemiCondensed-Bold',
    letterSpacing: 0.5,
  },
});
