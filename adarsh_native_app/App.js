import React, { useCallback, useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, StyleSheet, Animated, Image, Dimensions, Appearance, LogBox, ActivityIndicator } from 'react-native';
LogBox.ignoreAllLogs();
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { NavigationContainer } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { AuthProvider } from './src/context/AuthContext';
import AppNavigator from './src/navigation/AppNavigator';
import NetworkGuard from './src/components/NetworkGuard';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { colors } from './src/theme';

const { width, height } = Dimensions.get('window');

export default function App() {
  const [appReady, setAppReady] = useState(false);

  const [fontsLoaded, fontError] = useFonts({
    'SairaSemiCondensed-Regular': require('./assets/fonts/SairaSemiCondensed-Regular.ttf'),
    'SairaSemiCondensed-Medium': require('./assets/fonts/SairaSemiCondensed-Medium.ttf'),
    'SairaSemiCondensed-SemiBold': require('./assets/fonts/SairaSemiCondensed-Bold.ttf'),
    'SairaSemiCondensed-Bold': require('./assets/fonts/SairaSemiCondensed-Bold.ttf'),
  });

  useEffect(() => {
    async function prepare() {
      try {
        Appearance.setColorScheme('light');
        await SplashScreen.preventAutoHideAsync().catch(() => {});
        console.log('[App] Initialized Native Splash');
      } catch (e) {
        console.warn('[App] Splash init err', e);
      }
    }
    prepare();
  }, []);

  useEffect(() => {
    if (fontsLoaded || fontError) {
      console.log('[App] Fonts loaded status:', { fontsLoaded, fontError });
      setAppReady(true);
      // Fallback: hide splash after a delay even if onLayout doesn't fire
      setTimeout(() => {
        SplashScreen.hideAsync().catch(() => {});
      }, 500);
    }
  }, [fontsLoaded, fontError]);

  // Safety: Force ready after 4 seconds regardless of fonts
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!appReady) {
        console.log('[App] Safety trigger: forcing appReady true');
        setAppReady(true);
      }
    }, 4000);
    return () => clearTimeout(timer);
  }, [appReady]);


  const onLayoutRootView = useCallback(async () => {
    if (appReady) {
      console.log('[App] Hiding Splash via onLayout');
      await SplashScreen.hideAsync().catch(() => {});
    }
  }, [appReady]);

  // If fonts are not loaded, we still want to render the SafeAreaProvider and a basic loading view
  // so that the JS engine stays alive and can eventually trigger the hide.
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
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
              <NetworkGuard>
                <NavigationContainer>
                  <AppNavigator />
                </NavigationContainer>
              </NetworkGuard>
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
  line: {
    width: 40,
    height: 2,
    backgroundColor: '#38bdf8',
    marginVertical: 15,
    borderRadius: 1
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
    fontFamily: 'SairaSemiCondensed-Regular', 
    color: 'rgba(255,255,255,0.3)', 
    letterSpacing: 2 
  },
});
