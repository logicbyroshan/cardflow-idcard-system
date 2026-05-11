import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { colors, fontFamily } from '../theme';

const variantStyles = {
  display: { fontSize: 24, fontFamily: fontFamily.black, color: colors.gray900, lineHeight: 30 },
  title: { fontSize: 20, fontFamily: fontFamily.bold, color: colors.gray800, lineHeight: 26 },
  subtitle: { fontSize: 14, fontFamily: fontFamily.medium, color: colors.gray500, lineHeight: 20 },
  body: { fontSize: 13, fontFamily: fontFamily.regular, color: colors.gray700, lineHeight: 20 },
  caption: { fontSize: 11, fontFamily: fontFamily.medium, color: colors.gray500, lineHeight: 16 },
  label: { fontSize: 10, fontFamily: fontFamily.bold, color: colors.gray500, letterSpacing: 0.8, textTransform: 'uppercase' },
};

const weightMap = {
  regular: fontFamily.regular,
  medium: fontFamily.medium,
  semibold: fontFamily.semibold,
  bold: fontFamily.bold,
  black: fontFamily.black,
};

const Typography = React.memo(function Typography({
  variant = 'body',
  weight,
  color,
  align,
  style,
  children,
  ...props
}) {
  return (
    <Text
      style={[
        styles.base,
        variantStyles[variant] || variantStyles.body,
        weight && { fontFamily: weightMap[weight] || weightMap.regular },
        color && { color },
        align && { textAlign: align },
        style,
      ]}
      {...props}
    >
      {children}
    </Text>
  );
});

const styles = StyleSheet.create({
  base: {
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
});

export default Typography;
export { variantStyles, weightMap };
