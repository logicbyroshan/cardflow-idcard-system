import React from 'react';
import { TouchableOpacity, View, StyleSheet } from 'react-native';
import { colors, radius, fontFamily, typography, shadows } from '../theme';
import Typography from './Typography';

export default function ListItem({
  title,
  subtitle,
  leading,
  trailing,
  onPress,
  style,
  titleStyle,
  subtitleStyle,
  destructive = false,
}) {
  const Container = onPress ? TouchableOpacity : View;
  return (
    <Container
      onPress={onPress}
      activeOpacity={0.75}
      style={[styles.base, destructive && styles.destructive, style]}
    >
      {leading ? <View style={styles.leading}>{leading}</View> : null}
      <View style={styles.body}>
        <Typography variant="body" weight="bold" color={destructive ? colors.red : colors.gray800} style={titleStyle} numberOfLines={1}>
          {title}
        </Typography>
        {subtitle ? (
          <Typography variant="caption" color={colors.gray500} style={[styles.subtitle, subtitleStyle]} numberOfLines={2}>
            {subtitle}
          </Typography>
        ) : null}
      </View>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </Container>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray100,
    borderRadius: radius.lg,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    ...shadows.sm,
  },
  destructive: {
    borderColor: '#fecaca',
    backgroundColor: '#fff5f5',
  },
  leading: {
    marginRight: 12,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  subtitle: {
    marginTop: 2,
  },
  trailing: {
    marginLeft: 12,
  },
});
