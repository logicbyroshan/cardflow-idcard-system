import React, { useCallback, useState, useEffect, useRef } from 'react';
import { FontAwesome5, MaterialCommunityIcons } from '@expo/vector-icons';
import { View, Text, TextInput, StyleSheet, Animated, Image, Dimensions, Appearance, LogBox } from 'react-native';
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
    'SairaSemiCondensed-SemiBold': require('./assets/fonts/SairaSemiCondensed-SemiBold.ttf'),
    'SairaSemiCondensed-Bold': require('./assets/fonts/SairaSemiCondensed-Bold.ttf'),
    ...FontAwesome5.font,
    ...MaterialCommunityIcons.font,
  });

  useEffect(() => {
    async function prepare() {
      try {
        Appearance.setColorScheme('light');
        await SplashScreen.preventAutoHideAsync();
      } catch (e) {
        console.warn(e);
      }
    }
    prepare();
  }, []);

  useEffect(() => {
    if (fontsLoaded || fontError) {
      if (fontError) console.log('[App] Font Error:', fontError);
      console.log('[App] Fonts Loaded:', fontsLoaded);
      
      setAppReady(true);
      // Wait a tiny bit before hiding native splash to ensure JS is ready
      const t = setTimeout(() => {
        SplashScreen.hideAsync().catch(() => {});
      }, 200);
      return () => clearTimeout(t);
    }
  }, [fontsLoaded, fontError]);

  // Fail-safe timer (5 seconds max splash)
  useEffect(() => {
    const t = setTimeout(() => {
      if (!appReady) {
        console.log('[App] Splash Timeout — Forcing Ready');
        setAppReady(true);
      }
    }, 5000);
    return () => clearTimeout(t);
  }, [appReady]);

  if (!appReady) return null;

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <ErrorBoundary>
        <View style={{ flex: 1, backgroundColor: colors.brandPrimary }}>
          <AuthProvider>
            <StatusBar style="light" />
            <NetworkGuard>
              <NavigationContainer>
                <AppNavigator />
              </NavigationContainer>
            </NetworkGuard>
          </AuthProvider>
        </View>
      </ErrorBoundary>
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
