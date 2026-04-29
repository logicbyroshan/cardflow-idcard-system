import React from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import { colors, shadows, radius, spacing, typography } from '../theme';

const CardItem = React.memo(function CardItem({ item, onPress }) {
  const fd = item.field_data || {};
  // PWA Fallback Strategy: Check common name keys used in various client tables
  const name = item.name || fd.NAME || fd.Name || fd.name || fd.FULL_NAME || fd.full_name || fd['STUDENT NAME'] || `Card #${item.id}`;
  const rollNo = fd['ROLL NO'] || fd['ROLL_NO'] || fd.roll_no || fd.RollNo || '';
  const photoUrl = item.photo_url || '';

  return (
    <TouchableOpacity style={s.card} activeOpacity={0.7} onPress={onPress}>
      <View style={s.photoWrap}>
        {photoUrl ? (
          <Image source={{ uri: photoUrl }} style={s.photo} />
        ) : (
          <View style={s.photoPlaceholder}>
            <FontAwesome5 name="user" size={16} color={colors.gray300} solid />
          </View>
        )}
      </View>
      <View style={s.info}>
        <Text style={s.name} numberOfLines={1}>{name}</Text>
        <View style={s.metaRow}>
          {!!rollNo && (
            <View style={s.metaBadge}>
              <Text style={s.metaLabel}>ROLL</Text>
              <Text style={s.metaValue}>{rollNo}</Text>
            </View>
          )}
          {!!item.sr_no && (
            <View style={[s.metaBadge, { backgroundColor: colors.indigo50 }]}>
              <Text style={[s.metaLabel, { color: colors.brandPrimary }]}>SR</Text>
              <Text style={[s.metaValue, { color: colors.brandPrimaryDark }]}>{item.sr_no}</Text>
            </View>
          )}
        </View>
      </View>
      <View style={s.right}>
        <View style={s.chevron}>
          <FontAwesome5 name="chevron-right" size={10} color={colors.gray300} />
        </View>
      </View>
    </TouchableOpacity>
  );
});

const s = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    ...shadows.md,
  },
  photoWrap: {
    width: 56,
    height: 70,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: colors.gray50,
    borderWidth: 1,
    borderColor: colors.gray100,
  },
  photo: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  photoPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: {
    flex: 1,
    marginLeft: 16,
    justifyContent: 'center',
  },
  name: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.gray800,
    fontFamily: 'SairaSemiCondensed-Bold',
    marginBottom: 6,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  metaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.gray100,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    gap: 4,
  },
  metaLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: colors.gray500,
    fontFamily: 'SairaSemiCondensed-Bold',
  },
  metaValue: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.gray700,
    fontFamily: 'SairaSemiCondensed-Medium',
  },
  right: {
    paddingLeft: spacing.sm,
  },
  chevron: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.gray50,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default CardItem;
