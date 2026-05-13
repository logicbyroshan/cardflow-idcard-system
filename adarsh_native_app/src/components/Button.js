import React from 'react';
import { TouchableOpacity, Text, StyleSheet, View, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { DynamicIcon } from './Icons';
import { colors, gradients, radius, shadows, fontFamily, typography } from '../theme';

const Button = React.memo(function Button({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  fullWidth = false,
  icon,
  iconRight,
  onPress,
  style,
  contentStyle,
  textStyle,
  ...props
}) {
  const isDisabled = disabled || loading;
  const radiusStyle = style && StyleSheet.flatten(style).borderRadius ? { borderRadius: StyleSheet.flatten(style).borderRadius } : { borderRadius: radius.md };
  const containerStyle = [styles.base, styles[size], fullWidth && styles.fullWidth, isDisabled && styles.disabled, radiusStyle, style];

  const content = (
    <View style={[styles.content, contentStyle]}>
      {loading ? <ActivityIndicator size="small" color={variant === 'primary' ? colors.white : colors.brandPrimary} style={{ marginRight: 10 }} /> : null}
      {!loading && icon ? (
        <DynamicIcon 
          name={icon} 
          size={size === 'lg' ? 16 : 14} 
          color={variant === 'primary' ? colors.white : colors.brandPrimary} 
          style={styles.leftIcon} 
        />
      ) : null}
      <Text style={[styles.text, styles[`${variant}Text`], textStyle]}>{children}</Text>
      {!loading && iconRight ? (
        <DynamicIcon 
          name={iconRight} 
          size={size === 'lg' ? 16 : 14} 
          color={variant === 'primary' ? colors.white : colors.brandPrimary} 
          style={styles.rightIcon} 
        />
      ) : null}
    </View>
  );

  if (variant === 'primary' || variant === 'gradient') {
    return (
      <TouchableOpacity onPress={onPress} disabled={isDisabled} activeOpacity={0.85} style={containerStyle} {...props}>
        <LinearGradient colors={gradients.brand} style={[styles.fill, styles[size], radiusStyle]}>
          {content}
        </LinearGradient>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity onPress={onPress} disabled={isDisabled} activeOpacity={0.8} style={containerStyle} {...props}>
      {content}
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  fill: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWidth: {
    width: '100%',
  },
  disabled: {
    opacity: 0.55,
  },
  sm: {
    minHeight: 34,
    paddingHorizontal: 12,
  },
  md: {
    minHeight: 42,
    paddingHorizontal: 16,
  },
  lg: {
    minHeight: 48,
    paddingHorizontal: 18,
  },
  text: {
    fontFamily: 'SairaSemiCondensed-Bold',
    fontSize: typography.lg,
  },
  primaryText: { color: colors.white },
  secondaryText: { color: colors.gray700 },
  ghostText: { color: colors.brandPrimary },
  dangerText: { color: colors.red },
  leftIcon: { marginRight: 12 },
  rightIcon: { marginLeft: 12 },
  secondary: {
    backgroundColor: colors.gray50,
    borderWidth: 1,
    borderColor: colors.gray200,
    ...shadows.sm,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  danger: {
    backgroundColor: '#fff5f5',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
});

export default Button;
