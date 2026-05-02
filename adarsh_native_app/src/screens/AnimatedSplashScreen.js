import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Animated, StyleSheet, Dimensions, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { FontAwesome5 } from '@expo/vector-icons';
import { colors, gradients, radius, shadows, fontFamily } from '../theme';

const { width, height } = Dimensions.get('window');

export default function AnimatedSplashScreen({ onFinish }) {
  const [phase, setPhase] = useState(1); // 1: Yellow, 2: Gradient
  
  // Animation Values
  const logoScale = useRef(new Animated.Value(0.5)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const yellowOpacity = useRef(new Animated.Value(1)).current;
  const gradientOpacity = useRef(new Animated.Value(0)).current;
  const logoTranslateY = useRef(new Animated.Value(20)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // 1. Initial Logo Entrance (Phase 1: Yellow)
    Animated.sequence([
      Animated.delay(300),
      Animated.parallel([
        Animated.spring(logoScale, {
          toValue: 1,
          tension: 40,
          friction: 7,
          useNativeDriver: true,
        }),
        Animated.timing(logoOpacity, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(logoTranslateY, {
          toValue: 0,
          duration: 800,
          useNativeDriver: true,
        })
      ]),
      // 2. Transition to Gradient (Phase 2)
      Animated.delay(500),
      Animated.parallel([
        Animated.timing(yellowOpacity, {
          toValue: 0,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(gradientOpacity, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(textOpacity, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        })
      ]),
      // 3. Final Pause & Finish
      Animated.delay(800),
    ]).start(() => {
      if (onFinish) onFinish();
    });
  }, []);

  return (
    <View style={s.root}>
      {/* Layer 1: Brand Gradient (fades in) */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: gradientOpacity }]}>
        <LinearGradient colors={gradients.brandFull} style={StyleSheet.absoluteFill} />
      </Animated.View>

      {/* Layer 2: Initial Yellow (fades out) */}
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.yellow || '#f59e0b', opacity: yellowOpacity }]} />

      {/* Content */}
      <View style={s.center}>
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
          <LinearGradient colors={['rgba(255,255,255,0.3)', 'rgba(255,255,255,0.1)']} style={s.logoCircle}>
             <FontAwesome5 name="id-card" size={60} color="#fff" />
          </LinearGradient>
          
          <Animated.View style={[s.textWrap, { opacity: textOpacity }]}>
            <Text style={s.brandName}>ADARSH</Text>
            <Text style={s.brandSub}>ID CARDS & SYSTEMS</Text>
          </Animated.View>
        </Animated.View>
      </View>

      {/* Footer tagline */}
      <Animated.View style={[s.footer, { opacity: textOpacity }]}>
        <Text style={s.footerText}>Innovation In Identification</Text>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f59e0b' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  logoContainer: { alignItems: 'center' },
  logoCircle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.4)',
    ...shadows.xl,
  },
  textWrap: { marginTop: 24, alignItems: 'center' },
  brandName: {
    fontSize: 42,
    fontFamily: fontFamily.bold,
    color: '#fff',
    letterSpacing: 4,
    textShadowColor: 'rgba(0, 0, 0, 0.2)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },
  brandSub: {
    fontSize: 12,
    fontFamily: fontFamily.medium,
    color: 'rgba(255,255,255,0.7)',
    letterSpacing: 2,
    marginTop: 4,
  },
  footer: {
    position: 'absolute',
    bottom: 50,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 10,
    fontFamily: fontFamily.regular,
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
});
