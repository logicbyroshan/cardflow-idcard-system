import React, { useCallback, useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, StyleSheet, Animated, Image, Dimensions } from 'react-native';
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

const { width, height } = Dimensions.get('window');

export default function App() {
  const [appReady, setAppReady] = useState(false);
  const [splashDone, setSplashDone] = useState(false);

  const [fontsLoaded] = useFonts({
    'SairaSemiCondensed-Regular': require('./assets/fonts/SairaSemiCondensed-Regular.ttf'),
    'SairaSemiCondensed-Medium': require('./assets/fonts/SairaSemiCondensed-Medium.ttf'),
    'SairaSemiCondensed-SemiBold': require('./assets/fonts/SairaSemiCondensed-SemiBold.ttf'),
    'SairaSemiCondensed-Bold': require('./assets/fonts/SairaSemiCondensed-Bold.ttf'),
  });

  useEffect(() => {
    async function prepare() {
      try {
        await SplashScreen.preventAutoHideAsync();
      } catch (e) {
        console.warn(e);
      }
    }
    prepare();
  }, []);

  useEffect(() => {
    if (fontsLoaded) {
      setAppReady(true);
      // Wait a tiny bit before hiding native splash to ensure JS is ready
      setTimeout(() => {
        SplashScreen.hideAsync().catch(() => {});
      }, 200);
    }
  }, [fontsLoaded]);

  if (!appReady) return null;

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <ErrorBoundary>
        <View style={{ flex: 1, backgroundColor: '#667eea' }}>
          <AuthProvider>
            <StatusBar style="light" />
            {!splashDone ? (
              <AnimatedSplashScreen onFinish={() => setSplashDone(true)} />
            ) : (
              <NetworkGuard>
                <NavigationContainer>
                  <AppNavigator />
                </NavigationContainer>
              </NetworkGuard>
            )}
          </AuthProvider>
        </View>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

function AnimatedSplashScreen({ onFinish }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.95)).current;
  const logoScale = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, friction: 8, tension: 20, useNativeDriver: true }),
      Animated.spring(logoScale, { toValue: 1, friction: 6, tension: 30, useNativeDriver: true }),
    ]).start();

    const timer = setTimeout(() => {
      Animated.timing(fadeAnim, { toValue: 0, duration: 600, useNativeDriver: true }).start(onFinish);
    }, 3000);

    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={splash.container}>
      <LinearGradient 
        colors={['#0f172a', '#1e293b', '#334155']} 
        style={StyleSheet.absoluteFill} 
        start={{ x: 0, y: 0 }} 
        end={{ x: 1, y: 1 }} 
      />
      
      <Animated.View style={[splash.content, { opacity: fadeAnim, transform: [{ scale: scaleAnim }] }]}>
        <Animated.View style={[splash.logoGlow, { transform: [{ scale: logoScale }] }]}>
          <Image 
            source={require('./assets/logo.png')} 
            style={splash.logo} 
            resizeMode="contain" 
          />
        </Animated.View>
        
        <Text style={splash.title}>ADARSH</Text>
        <View style={splash.line} />
        <Text style={splash.subtitle}>PREMIUM PRINTING HUB</Text>
      </Animated.View>

      <Animated.View style={[splash.footer, { opacity: fadeAnim }]}>
        <View style={splash.loaderBar}>
          <Animated.View style={[splash.loaderProgress, { width: fadeAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
        </View>
        <Text style={splash.version}>v38.0.0 • PRODUCTION GRADE</Text>
      </Animated.View>
    </View>
  );
}

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
