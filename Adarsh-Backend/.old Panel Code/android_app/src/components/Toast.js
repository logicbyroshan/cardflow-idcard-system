import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DynamicIcon } from './Icons';
import { colors, typography, spacing, radius, shadows, fontFamily } from '../theme';

export default function Toast({ visible, message, type = 'info', duration = 2500, onHide }) {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(-100)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, tension: 80, friction: 10 }),
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();

      const timer = setTimeout(() => {
        Animated.parallel([
          Animated.timing(translateY, { toValue: -100, duration: 250, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: true }),
        ]).start(() => {
          if (onHide) onHide();
        });
      }, duration);

      return () => clearTimeout(timer);
    }
  }, [visible]);

  if (!visible && !message) return null;

  const bgColor = type === 'success' ? '#10b981'
    : type === 'error' ? '#ef4444'
    : '#6366f1';

  const icon = type === 'success' ? 'check-circle'
    : type === 'error' ? 'exclamation-circle'
    : 'info-circle';

  return (
    <Animated.View
      style={[
        styles.container,
        { 
          top: Math.max(insets.top, 20),
          backgroundColor: bgColor, 
          transform: [{ translateY }], 
          opacity 
        },
      ]}
    >
      <DynamicIcon name={icon} size={16} color="#fff" />
      <Text style={styles.text} numberOfLines={2}>{message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 20,
    right: 20,
    zIndex: 9999,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: radius.lg,
    ...shadows.xl,
  },
  text: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    fontFamily: 'SairaSemiCondensed-Bold',
  },
});
