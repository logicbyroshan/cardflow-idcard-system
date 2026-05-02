import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Animated, StyleSheet, Dimensions, Image, StatusBar } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { gradients, shadows, radius, fontFamily, colors } from '../theme';

const { width, height } = Dimensions.get('window');

export default function AnimatedSplashScreen({ onFinish }) {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  
  // Animation Values
  const logoScale = useRef(new Animated.Value(0.5)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoTranslateY = useRef(new Animated.Value(20)).current;
  const brandOpacity = useRef(new Animated.Value(0)).current;
  const brandTranslateY = useRef(new Animated.Value(10)).current;
  const welcomeOpacity = useRef(new Animated.Value(0)).current;
  const contentFadeOut = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Check login status for message
    const checkAuth = async () => {
      try {
        const authData = await AsyncStorage.getItem('adarsh_auth_state');
        setIsLoggedIn(!!authData);
      } catch (e) {}
    };
    checkAuth();

    // Start premium animation sequence
    Animated.sequence([
      // 1. Logo Fades & Springs in
      Animated.parallel([
        Animated.spring(logoScale, { toValue: 1, tension: 40, friction: 7, useNativeDriver: true }),
        Animated.timing(logoOpacity, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(logoTranslateY, { toValue: 0, duration: 800, useNativeDriver: true }),
      ]),
      // 2. Brand Name Fades in with slight slide up
      Animated.parallel([
        Animated.timing(brandOpacity, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(brandTranslateY, { toValue: 0, duration: 600, useNativeDriver: true }),
      ]),
      // 3. Welcome Message Fades in
      Animated.timing(welcomeOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      // 4. Hold for a moment
      Animated.delay(1200),
      // 5. Fade out everything gracefully
      Animated.timing(contentFadeOut, { toValue: 0, duration: 600, useNativeDriver: true }),
    ]).start(() => {
      if (onFinish) onFinish();
    });
  }, []);

  return (
    <View style={s.root}>
      <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
      <LinearGradient colors={gradients.brandFull} style={StyleSheet.absoluteFill} />

      <Animated.View style={[s.center, { opacity: contentFadeOut }]}>
        <Animated.View style={[
          s.logoContainer, 
          { 
            opacity: logoOpacity,
            transform: [
              { scale: logoScale },
              { translateY: logoTranslateY }
            ]
          }
        ]}>
          <View style={s.logoCircle}>
             <Image 
                source={require('../../assets/logo.png')} 
                style={s.logoImage}
                resizeMode="contain"
             />
          </View>
        </Animated.View>

        <Animated.View style={[
          s.textWrap, 
          { 
            opacity: brandOpacity,
            transform: [{ translateY: brandTranslateY }]
          }
        ]}>
          <Text style={s.brandName}>ADARSH ID CARD</Text>
          <View style={s.brandLine} />
        </Animated.View>

        <Animated.View style={[s.welcomeWrap, { opacity: welcomeOpacity }]}>
          <Text style={s.welcomeText}>{isLoggedIn ? 'Welcome back!' : 'Welcome'}</Text>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#667eea' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  logoContainer: { alignItems: 'center' },
  logoCircle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    ...shadows.xl,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  logoImage: {
    width: 85,
    height: 85,
  },
  textWrap: { marginTop: 32, alignItems: 'center' },
  brandName: {
    fontSize: 32,
    fontFamily: fontFamily.black,
    color: '#fff',
    letterSpacing: 3,
    textTransform: 'uppercase',
    textShadowColor: 'rgba(0,0,0,0.2)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },
  brandLine: {
    width: 40,
    height: 3,
    backgroundColor: '#fff',
    marginTop: 12,
    borderRadius: 2,
    opacity: 0.6,
  },
  welcomeWrap: { position: 'absolute', bottom: 80, width: '100%', alignItems: 'center' },
  welcomeText: {
    fontSize: 18,
    fontFamily: fontFamily.bold,
    color: 'rgba(255,255,255,0.9)',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
});
