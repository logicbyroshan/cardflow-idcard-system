import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet } from 'react-native';
import { colors, radius, shadows } from '../theme';

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

/** Card list skeleton — matches the premium card layout perfectly */
export const CardListSkeleton = React.memo(function CardListSkeleton() {
  return (
    <View style={presets.listWrap}>
      {[0, 1, 2, 3, 4, 5].map(i => (
        <View key={i} style={presets.skeletonCard}>
          <View style={presets.skeletonCardBody}>
            {/* Left Image Placeholder */}
            <View style={presets.skeletonImagesColumn}>
              <Skeleton width={50} height={60} radius={4} />
              <Skeleton width={32} height={8} style={{ marginTop: 4 }} />
            </View>
            {/* Right Fields List */}
            <View style={presets.skeletonFieldsList}>
              {[0, 1, 2].map(j => (
                <View key={j} style={presets.skeletonFieldRow}>
                  <Skeleton width="30%" height={9} />
                  <Skeleton width="40%" height={9} />
                </View>
              ))}
            </View>
          </View>
          {/* Bottom Actions Bar */}
          <View style={presets.skeletonCardActions}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Skeleton width={14} height={14} radius={3} />
              <Skeleton width={36} height={10} style={{ marginLeft: 6 }} />
            </View>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <Skeleton width={44} height={20} radius={4} />
              <Skeleton width={26} height={20} radius={4} />
            </View>
          </View>
        </View>
      ))}
    </View>
  );
});

/** Dashboard skeleton — stat cards + grid with vertical spacing */
export const DashboardSkeleton = React.memo(function DashboardSkeleton() {
  return (
    <View style={presets.dashWrap}>
      {/* Summary card */}
      <Skeleton width="100%" height={80} radius={16} style={{ marginBottom: 16 }} />
      <View style={presets.grid}>
        {[0, 1, 2, 3, 4, 5].map(i => (
          <Skeleton key={i} width="31%" height={80} radius={12} style={{ marginBottom: 10 }} />
        ))}
      </View>
      {/* Quick actions separator */}
      <Skeleton width="100%" height={48} radius={16} style={{ marginTop: 6, marginBottom: 16 }} />
      <View style={presets.grid}>
        {[0, 1, 2, 3, 4, 5].map(i => (
          <Skeleton key={i} width="30%" height={56} radius={12} style={{ marginBottom: 10 }} />
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
        <Skeleton width={90} height={110} radius={6} />
        <View style={presets.heroInfo}>
          <Skeleton width="80%" height={18} />
          <Skeleton width="50%" height={12} style={{ marginTop: 8 }} />
          <Skeleton width="60%" height={10} style={{ marginTop: 12 }} />
        </View>
      </View>
      {/* Fields */}
      {[0, 1, 2, 3, 4].map(i => (
        <View key={i} style={presets.fieldRow}>
          <Skeleton width="35%" height={11} />
          <Skeleton width="55%" height={11} />
        </View>
      ))}
      {/* Actions */}
      <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
        <Skeleton width="48%" height={44} radius={6} />
        <Skeleton width="48%" height={44} radius={6} />
      </View>
      <Skeleton width="100%" height={44} radius={6} style={{ marginTop: 12 }} />
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

/** Clients List screen skeleton loader */
export const ClientsListSkeleton = React.memo(function ClientsListSkeleton() {
  return (
    <View style={presets.listWrap}>
      {/* Search Header Placeholder */}
      <View style={{ flexDirection: 'row', paddingHorizontal: 16, marginVertical: 12, gap: 10 }}>
        <Skeleton width="85%" height={44} radius={radius.xs} />
        <Skeleton width={44} height={44} radius={radius.xs} />
      </View>
      {[0, 1, 2].map(i => (
        <View key={i} style={presets.clientsCard}>
          {/* Card Top */}
          <View style={presets.clientsCardTop}>
            <Skeleton width={44} height={44} radius={radius.xs} />
            <View style={{ flex: 1, marginLeft: 12, gap: 4 }}>
              <Skeleton width="50%" height={12} />
              <Skeleton width="80%" height={8} />
              <Skeleton width="60%" height={8} />
              <Skeleton width="70%" height={7} style={{ marginTop: 4 }} />
            </View>
            <Skeleton width={60} height={20} radius={radius.xs} />
          </View>
          {/* Stats Bar */}
          <View style={presets.clientsStatsRow}>
            {[0, 1, 2, 3, 4].map(j => (
              <Skeleton key={j} width="18%" height={26} radius={radius.xs} />
            ))}
          </View>
          {/* Action Row */}
          <View style={presets.clientsActionRow}>
            {[0, 1, 2, 3].map(k => (
              <Skeleton key={k} width="22%" height={32} radius={radius.xs} />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
});

/** Client Groups (Tables list) screen skeleton loader */
export const ClientGroupsSkeleton = React.memo(function ClientGroupsSkeleton() {
  return (
    <View style={presets.listWrap}>
      {/* Search and filters */}
      <View style={{ paddingHorizontal: 16, marginTop: 12, gap: 10 }}>
        <Skeleton width="100%" height={44} radius={radius.xs} />
        <View style={{ flexDirection: 'row', marginVertical: 8, gap: 8 }}>
          {[0, 1, 2, 3, 4].map(i => (
            <Skeleton key={i} width={70} height={28} radius={radius.xs} />
          ))}
        </View>
      </View>
      {/* Group headers and expanded tables */}
      {[0, 1].map(i => (
        <View key={i} style={presets.groupCard}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Skeleton width={32} height={32} radius={radius.xs} />
            <View style={{ flex: 1, marginLeft: 12, gap: 4 }}>
              <Skeleton width="40%" height={12} />
              <Skeleton width="20%" height={8} />
            </View>
            <Skeleton width={12} height={12} radius={6} />
          </View>
          {/* First group shows tables expanded */}
          {i === 0 && (
            <View style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: 10, gap: 12 }}>
              {[0, 1].map(j => (
                <View key={j} style={{ gap: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Skeleton width={24} height={24} radius={radius.xs} />
                    <Skeleton width="35%" height={10} style={{ marginLeft: 8 }} />
                    <View style={{ flex: 1 }} />
                    <Skeleton width={20} height={20} radius={radius.xs} />
                  </View>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    {[0, 1, 2, 3, 4].map(k => (
                      <Skeleton key={k} width="18%" height={22} radius={radius.xs} />
                    ))}
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      ))}
    </View>
  );
});

/** Groups (Manage groups) screen skeleton loader */
export const GroupsSkeleton = React.memo(function GroupsSkeleton() {
  return (
    <View style={presets.listWrap}>
      {[0, 1, 2, 3].map(i => (
        <View key={i} style={presets.groupsCard}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
            <Skeleton width={34} height={34} radius={radius.xs} />
            <View style={{ flex: 1, marginLeft: 12, gap: 4 }}>
              <Skeleton width="50%" height={12} />
              <Skeleton width="30%" height={8} />
            </View>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            {[0, 1, 2, 3, 4].map(j => (
              <Skeleton key={j} width="18%" height={32} radius={radius.xs} />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
});

/** Reprint Manager screen skeleton loader */
export const ReprintSkeleton = React.memo(function ReprintSkeleton() {
  return (
    <View style={presets.listWrap}>
      {/* 3 Summary Boxes */}
      <View style={{ flexDirection: 'row', paddingHorizontal: 16, paddingTop: 12, gap: 10, marginBottom: 16 }}>
        {[0, 1, 2].map(i => (
          <View key={i} style={presets.summarySkeleton}>
            <Skeleton width={32} height={32} radius={radius.sm} />
            <Skeleton width="40%" height={18} style={{ marginTop: 6 }} />
            <Skeleton width="60%" height={9} style={{ marginTop: 4 }} />
          </View>
        ))}
      </View>
      {[0, 1, 2].map(i => (
        <View key={i} style={presets.reprintCard}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Skeleton width={32} height={32} radius={8} />
            <Skeleton width="50%" height={11} style={{ marginLeft: 12 }} />
            <View style={{ flex: 1 }} />
            <Skeleton width={10} height={10} radius={2} />
          </View>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#f1f5f9' }}>
            <Skeleton width="48%" height={36} radius={radius.xs} />
            <Skeleton width="48%" height={36} radius={radius.xs} />
          </View>
        </View>
      ))}
    </View>
  );
});

/** Staff Manager screen skeleton loader */
export const StaffManageSkeleton = React.memo(function StaffManageSkeleton() {
  return (
    <View style={presets.listWrap}>
      <View style={{ flexDirection: 'row', paddingHorizontal: 16, marginVertical: 12, gap: 10 }}>
        <Skeleton width="85%" height={44} radius={radius.xs} />
        <Skeleton width={44} height={44} radius={radius.xs} />
      </View>
      {[0, 1, 2, 3].map(i => (
        <View key={i} style={presets.staffCard}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Skeleton width={40} height={40} radius={radius.xs} />
            <View style={{ flex: 1, marginLeft: 12, gap: 4 }}>
              <Skeleton width="45%" height={11} />
              <Skeleton width="60%" height={8} />
            </View>
            <Skeleton width={60} height={18} radius={radius.xs} />
          </View>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#f1f5f9' }}>
            <Skeleton width="30%" height={32} radius={radius.xs} />
            <Skeleton width="30%" height={32} radius={radius.xs} />
            <Skeleton width="30%" height={32} radius={radius.xs} />
          </View>
        </View>
      ))}
    </View>
  );
});

/** Table Picker screen skeleton loader */
export const TablePickerSkeleton = React.memo(function TablePickerSkeleton() {
  return (
    <View style={presets.listWrap}>
      {[0, 1, 2, 3, 4].map(i => (
        <View key={i} style={presets.tablePickerCard}>
          <Skeleton width={44} height={44} radius={radius.sm} />
          <View style={{ flex: 1, marginLeft: 12, gap: 4 }}>
            <Skeleton width="55%" height={12} />
            <Skeleton width="35%" height={8} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Skeleton width={42} height={28} radius={radius.sm} />
            <Skeleton width={10} height={10} radius={5} />
          </View>
        </View>
      ))}
    </View>
  );
});

/** Notifications screen skeleton loader */
export const NotificationsSkeleton = React.memo(function NotificationsSkeleton() {
  return (
    <View style={presets.listWrap}>
      {[0, 1, 2, 3, 4].map(i => (
        <View key={i} style={presets.notificationCard}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
            <Skeleton width={40} height={40} radius={12} />
            <View style={{ flex: 1, marginLeft: 12, gap: 5 }}>
              <Skeleton width="50%" height={12} />
              <Skeleton width="90%" height={8} />
              <Skeleton width="75%" height={8} />
              <Skeleton width="30%" height={7} style={{ marginTop: 4 }} />
            </View>
          </View>
        </View>
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
  listWrap: { paddingHorizontal: 0, paddingVertical: 8 },
  skeletonCard: { 
    backgroundColor: '#fff', 
    borderRadius: radius.xs, 
    marginHorizontal: 12, 
    marginBottom: 10, 
    borderWidth: 1, 
    borderColor: '#f1f5f9',
    overflow: 'hidden'
  },
  skeletonCardBody: { 
    flexDirection: 'row', 
    padding: 8 
  },
  skeletonImagesColumn: { 
    width: 50, 
    alignItems: 'center',
    marginRight: 12 
  },
  skeletonFieldsList: { 
    flex: 1, 
    justifyContent: 'center' 
  },
  skeletonFieldRow: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    paddingVertical: 4, 
    borderBottomWidth: 1, 
    borderColor: '#f8fafc' 
  },
  skeletonCardActions: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between', 
    paddingHorizontal: 10, 
    paddingVertical: 6, 
    borderTopWidth: 1, 
    borderColor: '#f1f5f9', 
    backgroundColor: '#fafafa' 
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 20, padding: 14, borderWidth: 1, borderColor: '#f1f5f9' },
  cardInfo: { flex: 1 },
  dashWrap: { padding: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  detailWrap: { padding: 16 },
  heroRow: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: radius.sm, padding: 16, borderWidth: 1, borderColor: '#f1f5f9', marginBottom: 16 },
  heroInfo: { flex: 1, paddingLeft: 16, justifyContent: 'center' },
  fieldRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f9fafb' },
  profileWrap: { padding: 16 },
  settingsWrap: { padding: 16 },
  clientsCard: { backgroundColor: '#fff', borderRadius: radius.sm, padding: 14, marginHorizontal: 16, marginBottom: 12, borderWidth: 1, borderColor: '#f1f5f9', ...shadows.sm },
  clientsCardTop: { flexDirection: 'row', alignItems: 'center' },
  clientsStatsRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#f1f5f9', marginTop: 10 },
  clientsActionRow: { flexDirection: 'row', gap: 10, padding: 12, backgroundColor: '#fafafa', borderBottomLeftRadius: radius.sm, borderBottomRightRadius: radius.sm },
  groupCard: { backgroundColor: '#fff', borderRadius: radius.sm, padding: 12, marginHorizontal: 16, marginBottom: 12, borderWidth: 1, borderColor: '#f1f5f9', ...shadows.sm },
  groupsCard: { backgroundColor: '#fff', borderRadius: radius.sm, padding: 14, borderWidth: 1, borderColor: colors.gray100, ...shadows.sm, marginBottom: 10, marginHorizontal: 16 },
  summarySkeleton: { flex: 1, backgroundColor: '#fff', borderRadius: radius.sm, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: '#f1f5f9', ...shadows.sm },
  reprintCard: { backgroundColor: '#fff', borderRadius: radius.sm, padding: 10, marginHorizontal: 16, marginBottom: 12, borderWidth: 1, borderColor: '#f1f5f9', ...shadows.sm },
  staffCard: { backgroundColor: '#fff', borderRadius: radius.xs, padding: 12, marginBottom: 12, ...shadows.sm, borderWidth: 1, borderColor: colors.gray100, marginHorizontal: 16 },
  tablePickerCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: radius.md, padding: 14, borderWidth: 1, borderColor: '#f1f5f9', ...shadows.sm, marginHorizontal: 16, marginBottom: 10 },
  notificationCard: { backgroundColor: '#fff', borderRadius: 20, padding: 14, borderWidth: 1, borderColor: '#f1f5f9', ...shadows.sm, marginHorizontal: 16, marginBottom: 10 },
});
