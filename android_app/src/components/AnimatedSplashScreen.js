import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Dimensions, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

const { width, height } = Dimensions.get('window');

// We animate translation of a larger gradient background to make it feel alive
const AnimatedGradient = Animated.createAnimatedComponent(LinearGradient);

export default function AnimatedSplashScreen() {
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const logoPulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Background movement animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(pan, {
          toValue: { x: -width * 0.5, y: -height * 0.5 },
          duration: 10000,
          useNativeDriver: true,
        }),
        Animated.timing(pan, {
          toValue: { x: 0, y: 0 },
          duration: 10000,
          useNativeDriver: true,
        }),
      ])
    ).start();

    // Logo pulsing animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(logoPulse, {
          toValue: 1.05,
          duration: 1500,
          useNativeDriver: true,
        }),
        Animated.timing(logoPulse, {
          toValue: 1,
          duration: 1500,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  return (
    <View style={styles.container}>
      <Animated.View style={[
          StyleSheet.absoluteFillObject,
          {
            width: width * 2,
            height: height * 2,
            transform: [
              { translateX: pan.x },
              { translateY: pan.y }
            ]
          }
      ]}>
        <LinearGradient
          colors={['#f97316', '#ef4444', '#dc2626']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
      </Animated.View>

      <Animated.View style={[styles.content, { transform: [{ scale: logoPulse }] }]}>
        <Animated.Image 
          source={require('../../assets/logo.png')} 
          style={styles.logo} 
          resizeMode="contain" 
        />
        <Text style={styles.title}>ADARSH</Text>
        <ActivityIndicator color="#fff" style={styles.loader} size="large" />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: '#ef4444',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  logo: {
    width: 120,
    height: 120,
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    color: '#ffffff',
    fontFamily: 'SairaSemiCondensed-Bold',
    letterSpacing: 2,
    marginBottom: 30,
  },
  loader: {
    marginTop: 20,
  }
});
