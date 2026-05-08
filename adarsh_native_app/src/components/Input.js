import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import { colors, radius, fontFamily, typography } from '../theme';

export default function Input({
  label,
  error,
  leftIcon,
  rightIcon,
  secureTextEntry,
  containerStyle,
  inputStyle,
  labelStyle,
  errorStyle,
  style,
  ...props
}) {
  const [hidden, setHidden] = useState(!!secureTextEntry);
  const showToggle = typeof secureTextEntry === 'boolean' || secureTextEntry;

  return (
    <View style={[styles.wrap, containerStyle]}>
      {label ? <Text style={[styles.label, labelStyle]}>{label}</Text> : null}
      <View style={[styles.field, error && styles.fieldError, style]}>
        {leftIcon ? <FontAwesome5 name={leftIcon} size={12} color={colors.gray400} style={styles.leftIcon} /> : null}
        <TextInput
          style={[styles.input, leftIcon && styles.inputWithLeft, showToggle && styles.inputWithRight, inputStyle]}
          placeholderTextColor={colors.gray300}
          secureTextEntry={hidden}
          {...props}
        />
        {showToggle ? (
          <TouchableOpacity onPress={() => setHidden(v => !v)} style={styles.rightBtn} activeOpacity={0.7}>
            <FontAwesome5 name={hidden ? 'eye' : 'eye-slash'} size={12} color={colors.gray400} />
          </TouchableOpacity>
        ) : rightIcon ? (
          <View style={styles.rightBtn}>
            <FontAwesome5 name={rightIcon} size={12} color={colors.gray400} />
          </View>
        ) : null}
      </View>
      {error ? <Text style={[styles.error, errorStyle]}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 12,
  },
  label: {
    fontSize: typography.xs,
    fontFamily: fontFamily.bold,
    color: colors.gray500,
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  field: {
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gray200,
    backgroundColor: colors.gray50,
    flexDirection: 'row',
    alignItems: 'center',
  },
  fieldError: {
    borderColor: colors.error,
  },
  leftIcon: {
    marginLeft: 14,
  },
  input: {
    flex: 1,
    color: colors.gray800,
    fontSize: typography.base,
    fontFamily: fontFamily.regular,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  inputWithLeft: {
    paddingLeft: 10,
  },
  inputWithRight: {
    paddingRight: 40,
  },
  rightBtn: {
    width: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: {
    color: colors.error,
    fontSize: typography.xs,
    fontFamily: fontFamily.medium,
    marginTop: 4,
  },
});