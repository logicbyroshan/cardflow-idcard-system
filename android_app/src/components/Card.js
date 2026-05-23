import React from 'react';
import { View, StyleSheet } from 'react-native';
import { colors, radius, shadows } from '../theme';

export default function Card({ variant = 'surface', padding = 16, style, children }) {
  const variantStyles =
    variant === 'outlined' ? styles.outlined
      : variant === 'elevated' ? styles.elevated
      : variant === 'glass' ? styles.glass
      : styles.surface;

  return <View style={[styles.base, variantStyles, { padding }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.lg,
  },
  surface: {
    backgroundColor: colors.white,
  },
  outlined: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray100,
  },
  elevated: {
    backgroundColor: colors.white,
    ...shadows.md,
  },
  glass: {
    backgroundColor: colors.glassBg,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
});
