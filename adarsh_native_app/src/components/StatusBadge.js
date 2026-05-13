import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, typography, spacing, radius } from '../theme';
import { DynamicIcon } from './Icons';


const STATUS_STYLES = {
  pending:  { bg: colors.pending.bg,  text: colors.pending.text,  glass: colors.pendingGlass,  label: 'Pending', icon: 'clock' },
  verified: { bg: colors.verified.bg, text: colors.verified.text, glass: colors.verifiedGlass, label: 'Verified', icon: 'check-circle' },
  approved: { bg: colors.approved.bg, text: colors.approved.text, glass: colors.approvedGlass, label: 'Approved', icon: 'user-check' },
  download: { bg: colors.download.bg, text: colors.download.text, glass: colors.downloadGlass, label: 'Download', icon: 'download' },
  pool:     { bg: colors.pool.bg,     text: colors.pool.text,     glass: colors.poolGlass,     label: 'Pool', icon: 'layer-group' },
};

export default function StatusBadge({ status, count, size = 'md', variant = 'solid', showIcon = false }) {
  const style = STATUS_STYLES[status] || { bg: colors.gray100, text: colors.gray600, glass: 'rgba(0,0,0,0.03)', label: status, icon: 'info-circle' };
  const isLarge = size === 'lg';
  const isGlass = variant === 'glass';

  return (
    <View style={[
      styles.badge,
      { backgroundColor: isGlass ? style.glass : style.bg },
      isLarge && styles.badgeLg,
      isGlass && styles.badgeGlass,
      isGlass && { borderColor: style.text + '20' }
    ]}>
      {showIcon && <DynamicIcon name={style.icon} size={isLarge ? 12 : 9} color={style.text} style={{ marginRight: 6 }} />}
      <Text style={[
        styles.text,
        { color: style.text },
        isLarge && styles.textLg,
      ]}>
        {count !== undefined ? count : style.label.toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 42,
  },
  badgeLg: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    minWidth: 52,
  },
  badgeGlass: {
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
  },
  text: {
    fontSize: typography.xxs + 1,
    fontFamily: 'SairaSemiCondensed-Bold',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  textLg: {
    fontSize: typography.sm,
    fontFamily: 'SairaSemiCondensed-Bold',
  },
});
