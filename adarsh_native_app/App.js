import React, { useCallback } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { AuthProvider } from './src/context/AuthContext';
import AppNavigator from './src/navigation/AppNavigator';
import NetworkGuard from './src/components/NetworkGuard';
import AnimatedSplashScreen from './src/screens/AnimatedSplashScreen';

// Keep splash screen visible while loading fonts
SplashScreen.preventAutoHideAsync().catch(() => {});

// ── Force Saira SemiCondensed on TextInput ──
const defaultTextStyle = { fontFamily: 'SairaSemiCondensed-Regular' };
if (TextInput.defaultProps == null) TextInput.defaultProps = {};
TextInput.defaultProps.style = [defaultTextStyle, TextInput.defaultProps.style];

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    'SairaSemiCondensed-Regular': require('./assets/fonts/saira-semi-condensed-400.ttf'),
    'SairaSemiCondensed-Medium': require('./assets/fonts/saira-semi-condensed-500.ttf'),
    'SairaSemiCondensed-SemiBold': require('./assets/fonts/saira-semi-condensed-600.ttf'),
    'SairaSemiCondensed-Bold': require('./assets/fonts/saira-semi-condensed-700.ttf'),
  });

  const [animationFinished, setAnimationFinished] = React.useState(false);

  const onLayoutRootView = useCallback(async () => {
    if (fontsLoaded || fontError) {
      // We don't hide it immediately, we let our custom animation take over
      // or we hide it and show our custom component
      await SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, fontError]);

  if (!animationFinished) {
    return (
      <View style={{ flex: 1 }} onLayout={onLayoutRootView}>
        <AnimatedSplashScreen onFinish={() => setAnimationFinished(true)} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <View style={{ flex: 1 }}>
        <AuthProvider>
          <StatusBar style="light" />
          <NetworkGuard>
            <AppNavigator />
          </NetworkGuard>
        </AuthProvider>
      </View>
    </SafeAreaProvider>
  );
}
