import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { colors, fontFamily } from '../theme';

const variantStyles = {
  display: { fontSize: 24, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray900, lineHeight: 30 },
  title: { fontSize: 20, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray800, lineHeight: 26 },
  subtitle: { fontSize: 14, fontFamily: 'SairaSemiCondensed-Medium', color: colors.gray500, lineHeight: 20 },
  body: { fontSize: 13, fontFamily: 'SairaSemiCondensed-Regular', color: colors.gray700, lineHeight: 20 },
  caption: { fontSize: 11, fontFamily: 'SairaSemiCondensed-Medium', color: colors.gray500, lineHeight: 16 },
  label: { fontSize: 10, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray500, letterSpacing: 0.8, textTransform: 'uppercase' },
};

const weightMap = {
  regular: 'SairaSemiCondensed-Regular',
  medium: 'SairaSemiCondensed-Medium',
  semibold: 'SairaSemiCondensed-SemiBold',
  bold: 'SairaSemiCondensed-Bold',
  black: 'SairaSemiCondensed-Bold',
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
