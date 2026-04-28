import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, typography, spacing, radius } from '../theme';

const STATUS_STYLES = {
  pending:  { bg: colors.pending.bg,  text: colors.pending.text,  label: 'Pending' },
  verified: { bg: colors.verified.bg, text: colors.verified.text, label: 'Verified' },
  approved: { bg: colors.approved.bg, text: colors.approved.text, label: 'Approved' },
  download: { bg: colors.download.bg, text: colors.download.text, label: 'Download' },
  pool:     { bg: colors.pool.bg,     text: colors.pool.text,     label: 'Pool' },
};

export default function StatusBadge({ status, count, size = 'md' }) {
  const style = STATUS_STYLES[status] || { bg: colors.gray100, text: colors.gray600, label: status };
  const isLarge = size === 'lg';

  return (
    <View style={[
      styles.badge,
      { backgroundColor: style.bg },
      isLarge && styles.badgeLg,
    ]}>
      <Text style={[
        styles.text,
        { color: style.text },
        isLarge && styles.textLg,
      ]}>
        {count !== undefined ? count : style.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
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
    borderRadius: radius.lg,
    minWidth: 52,
  },
  text: {
    fontSize: typography.xs,
    fontWeight: typography.bold,
  },
  textLg: {
    fontSize: typography.sm,
    fontWeight: typography.extrabold,
  },
});
