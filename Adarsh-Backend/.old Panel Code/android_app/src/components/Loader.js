import React from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import Typography from './Typography';
import { colors } from '../theme';

export default function Loader({ size = 'large', color = colors.brandPrimary, label, style }) {
  return (
    <View style={[styles.wrap, style]}>
      <ActivityIndicator size={size} color={color} />
      {label ? <Typography variant="caption" align="center" style={styles.label}>{label}</Typography> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    marginTop: 8,
  },
});
