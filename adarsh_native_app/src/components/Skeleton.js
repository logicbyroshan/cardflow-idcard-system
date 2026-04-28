import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet } from 'react-native';
import { colors, radius } from '../theme';

/**
 * Shimmer skeleton loader with pulse animation.
 * Usage:
 *   <Skeleton width={100} height={14} />
 *   <Skeleton width="60%" height={14} radius={8} />
 *   <Skeleton circle size={48} />
 */
const Skeleton = React.memo(function Skeleton({ width, height = 14, radius: r = 8, circle, size, style }) {
  const pulseAnim = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulseAnim]);

  const finalWidth = circle ? size : width;
  const finalHeight = circle ? size : height;
  const finalRadius = circle ? (size || 0) / 2 : r;

  return (
    <Animated.View
      style={[
        styles.bone,
        { width: finalWidth, height: finalHeight, borderRadius: finalRadius, opacity: pulseAnim },
        style,
      ]}
    />
  );
});

export default Skeleton;

// ─── Preset Skeleton Layouts ────────────────────────────────────────────────

/** Card list skeleton — shows 6 card placeholders */
export const CardListSkeleton = React.memo(function CardListSkeleton() {
  return (
    <View style={presets.listWrap}>
      {[0, 1, 2, 3, 4, 5].map(i => (
        <View key={i} style={presets.cardRow}>
          <Skeleton circle size={48} />
          <View style={presets.cardInfo}>
            <Skeleton width="70%" height={13} />
            <Skeleton width="45%" height={10} style={{ marginTop: 6 }} />
          </View>
          <Skeleton width={56} height={22} radius={6} />
        </View>
      ))}
    </View>
  );
});

/** Dashboard skeleton — stat cards + grid */
export const DashboardSkeleton = React.memo(function DashboardSkeleton() {
  return (
    <View style={presets.dashWrap}>
      {/* Summary card */}
      <Skeleton width="100%" height={80} radius={20} style={{ marginBottom: 16 }} />
      {/* Status cards grid */}
      <View style={presets.grid}>
        {[0, 1, 2, 3, 4].map(i => (
          <Skeleton key={i} width="47%" height={72} radius={16} />
        ))}
      </View>
      {/* Quick actions */}
      <Skeleton width="100%" height={48} radius={16} style={{ marginTop: 16 }} />
      <View style={[presets.grid, { marginTop: 12 }]}>
        {[0, 1, 2, 3, 4, 5].map(i => (
          <Skeleton key={i} width="30%" height={56} radius={12} />
        ))}
      </View>
    </View>
  );
});

/** Detail skeleton — hero + fields */
export const DetailSkeleton = React.memo(function DetailSkeleton() {
  return (
    <View style={presets.detailWrap}>
      {/* Hero card */}
      <View style={presets.heroRow}>
        <Skeleton width={80} height={100} radius={12} />
        <View style={presets.heroInfo}>
          <Skeleton width="80%" height={16} />
          <Skeleton width="50%" height={12} style={{ marginTop: 8 }} />
          <Skeleton width="60%" height={10} style={{ marginTop: 8 }} />
          <Skeleton width="40%" height={10} style={{ marginTop: 4 }} />
        </View>
      </View>
      {/* Fields */}
      {[0, 1, 2, 3].map(i => (
        <View key={i} style={presets.fieldRow}>
          <Skeleton width="35%" height={11} />
          <Skeleton width="55%" height={11} />
        </View>
      ))}
      {/* Actions */}
      <Skeleton width="100%" height={48} radius={20} style={{ marginTop: 20 }} />
      <Skeleton width="100%" height={48} radius={20} style={{ marginTop: 10 }} />
    </View>
  );
});

/** Profile skeleton */
export const ProfileSkeleton = React.memo(function ProfileSkeleton() {
  return (
    <View style={presets.profileWrap}>
      <View style={{ alignItems: 'center', marginBottom: 20 }}>
        <Skeleton circle size={80} />
        <Skeleton width={120} height={16} style={{ marginTop: 12 }} />
        <Skeleton width={160} height={12} style={{ marginTop: 6 }} />
      </View>
      {[0, 1, 2, 3].map(i => (
        <Skeleton key={i} width="100%" height={52} radius={16} style={{ marginBottom: 10 }} />
      ))}
    </View>
  );
});

/** Settings skeleton */
export const SettingsSkeleton = React.memo(function SettingsSkeleton() {
  return (
    <View style={presets.settingsWrap}>
      <View style={presets.grid}>
        {[0, 1, 2, 3].map(i => (
          <Skeleton key={i} width="47%" height={72} radius={16} />
        ))}
      </View>
      <Skeleton width="100%" height={200} radius={16} style={{ marginTop: 16 }} />
    </View>
  );
});

/** Generic list skeleton */
export const ListSkeleton = React.memo(function ListSkeleton({ rows = 6 }) {
  return (
    <View style={presets.listWrap}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} width="100%" height={60} radius={16} style={{ marginBottom: 10 }} />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  bone: {
    backgroundColor: '#e8edf3',
  },
});

const presets = StyleSheet.create({
  listWrap: { padding: 16, gap: 10 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 20, padding: 14, borderWidth: 1, borderColor: '#f1f5f9' },
  cardInfo: { flex: 1 },
  dashWrap: { padding: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  detailWrap: { padding: 16 },
  heroRow: { flexDirection: 'row', gap: 16, backgroundColor: '#fff', borderRadius: 20, padding: 16, borderWidth: 1, borderColor: '#f1f5f9', marginBottom: 16 },
  heroInfo: { flex: 1, paddingTop: 4 },
  fieldRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f9fafb' },
  profileWrap: { padding: 16 },
  settingsWrap: { padding: 16 },
});
