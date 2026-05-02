import React from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import { colors, shadows, radius, spacing, typography, fontFamily } from '../theme';

const CardItem = React.memo(function CardItem({ item, showCheckbox, isSelected, onToggleSelect, onEdit, currentStatus, onStatusChange, onPool, onDelete }) {
  const fd = item.field_data || {};
  
  const orderedFields = item.ordered_fields || [];
  let imageFields = [];
  let textFields = [];

  // If we have ordered_fields (from backend schema), use them to show ALL fields even if empty
  if (orderedFields.length > 0) {
    orderedFields.forEach(f => {
      const val = fd[f.name] || '';
      if (f.type === 'image' || f.type === 'photo') {
        imageFields.push({ name: f.name, value: val });
      } else {
        textFields.push({ name: f.name, value: val });
      }
    });
  } else {
    // Fallback to what's in field_data
    Object.entries(fd).forEach(([key, value]) => {
      const k = key.toUpperCase();
      const v = String(value || '');
      const isImageKey = k.includes('PHOTO') || k.includes('SIGN') || k.includes('IMAGE');
      const isImageVal = v.match(/\.(jpg|jpeg|png|webp|gif)$/i) || v.startsWith('http') || v.startsWith('PENDING:') || v === 'NOT_FOUND';
      
      if (isImageKey || isImageVal) {
        imageFields.push({ name: key, value: v });
      } else {
        textFields.push({ name: key, value: v });
      }
    });
  }

  const renderImageStatus = (field) => {
    const val = String(field.value || '');
    const isPending = val.startsWith('PENDING:');
    const isEmpty = !val || val === 'NOT_FOUND' || val === 'null' || val === 'undefined';
    const isComplete = !isPending && !isEmpty;

    const isMainPhoto = field.name.toUpperCase() === 'PHOTO';
    
    let actualImageUrl = null;
    if (isComplete) {
      if (val.startsWith('http')) actualImageUrl = val;
      else if (isMainPhoto && item.photo_url) actualImageUrl = item.photo_url;
      else if (val.startsWith('file://') || val.startsWith('content://')) actualImageUrl = val;
    }

    let bgColor = '#f8fafc';
    let iconName = 'camera';
    let iconColor = colors.gray300;

    if (isPending) {
      bgColor = '#fff7ed';
      iconName = 'clock';
      iconColor = '#f97316';
    } else if (isEmpty) {
      bgColor = '#fef2f2'; // Reddish for missing
      iconName = 'user-slash';
      iconColor = '#fca5a5';
    } else if (isComplete && !actualImageUrl) {
      bgColor = '#f0fdf4';
      iconName = 'image';
      iconColor = '#22c55e';
    }

    return (
      <View key={field.name} style={s.imgBoxWrap}>
        <View style={[s.imgBox, { backgroundColor: bgColor, borderColor: isEmpty ? '#fecaca' : colors.gray200 }]}>
          {actualImageUrl ? (
            <Image source={{ uri: actualImageUrl }} style={s.actualImg} />
          ) : (
            <View style={s.photoPlaceholderCenter}>
              <FontAwesome5 name={iconName} size={18} color={iconColor} solid />
              {isEmpty && <Text style={s.emptyPhotoText}>EMPTY</Text>}
            </View>
          )}
        </View>
        <Text style={s.imgBoxLabel} numberOfLines={1}>{field.name}</Text>
      </View>
    );
  };

  return (
    <View style={[s.card, isSelected && s.cardSelected]}>
      <View style={s.cardBody}>
        {imageFields.length > 0 && (
          <View style={s.imagesColumn}>
            {imageFields.map(img => renderImageStatus(img))}
          </View>
        )}
        
        <View style={s.fieldsList}>
          {textFields.map(f => (
            <View key={f.name} style={s.fieldRow}>
              <Text style={s.fieldLabel}>{f.name}</Text>
              <View style={s.fieldValueWrap}>
                <Text style={[s.fieldValue, !f.value && s.fieldValueEmpty]}>
                  {f.value || 'NOT ADDED'}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      {/* Card Actions */}
      <View style={s.cardActions}>
        <View style={s.leftActions}>
          {showCheckbox && (
            <TouchableOpacity style={s.checkboxRow} onPress={onToggleSelect} activeOpacity={0.7}>
              <View style={[s.checkboxSmall, isSelected && s.checkboxCheckedSmall]}>
                {isSelected && <FontAwesome5 name="check" size={8} color="#fff" />}
              </View>
              <Text style={s.checkboxLabel}>Select</Text>
            </TouchableOpacity>
          )}
        </View>
        <View style={s.rightActions}>
          {onEdit && (
            <TouchableOpacity onPress={onEdit} style={s.editBtnWrap} activeOpacity={0.7}>
              <Text style={s.editBtnText}>Edit</Text>
            </TouchableOpacity>
          )}

          {currentStatus === 'pending' && onStatusChange && (
            <TouchableOpacity onPress={() => onStatusChange('verified')} style={s.actionBtnGreen} activeOpacity={0.7}>
              <Text style={s.actionBtnTextGreen}>Verify</Text>
            </TouchableOpacity>
          )}
          
          {currentStatus === 'verified' && onStatusChange && (
            <>
              <TouchableOpacity onPress={() => onStatusChange('approved')} style={s.actionBtnGreen} activeOpacity={0.7}>
                <Text style={s.actionBtnTextGreen}>Approve</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => onStatusChange('pending')} style={s.actionBtnOrange} activeOpacity={0.7}>
                <Text style={s.actionBtnTextOrange}>Unverify</Text>
              </TouchableOpacity>
            </>
          )}

          {currentStatus === 'approved' && onStatusChange && (
            <TouchableOpacity onPress={() => onStatusChange('verified')} style={s.actionBtnOrange} activeOpacity={0.7}>
              <Text style={s.actionBtnTextOrange}>Unapprove</Text>
            </TouchableOpacity>
          )}

          {currentStatus === 'pool' && onStatusChange && (
            <TouchableOpacity onPress={() => onStatusChange('pending')} style={s.actionBtnGreen} activeOpacity={0.7}>
              <Text style={s.actionBtnTextGreen}>Retrieve</Text>
            </TouchableOpacity>
          )}

          {onDelete && (
            <TouchableOpacity onPress={onDelete} style={s.actionBtnRed} activeOpacity={0.7}>
              <Text style={s.actionBtnTextRed}>Delete</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
});

const s = StyleSheet.create({
  card: {
    width: '100%',
    backgroundColor: colors.white,
    borderRadius: radius.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    overflow: 'hidden',
    ...shadows.sm,
  },
  cardSelected: {
    borderColor: colors.brandPrimary,
    backgroundColor: '#fafbff',
  },
  imagesColumn: {
    flexDirection: 'column',
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingLeft: spacing.sm,
    paddingBottom: spacing.sm,
    width: 68,
  },
  imgBoxWrap: {
    alignItems: 'center',
    width: 56,
    marginBottom: 8,
  },
  imgBox: {
    width: 52,
    height: 60,
    borderRadius: radius.xs,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 3,
    borderWidth: 1,
    overflow: 'hidden',
  },
  actualImg: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  imgBoxLabel: {
    fontSize: 8,
    fontFamily: fontFamily.bold,
    color: colors.gray500,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  cardBody: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    overflow: 'hidden',
  },
  fieldsList: {
    flex: 1,
    minWidth: 0,
    padding: spacing.sm,
    paddingHorizontal: 10,
    gap: 0,
  },
  fieldRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 2,
    borderBottomWidth: 1,
    borderBottomColor: '#f8fafc',
    overflow: 'hidden',
  },
  fieldLabel: {
    fontSize: 10,
    fontFamily: fontFamily.semibold,
    color: colors.gray400,
    width: 70,
    flexShrink: 0,
    textTransform: 'uppercase',
    marginTop: 1,
    paddingRight: 4,
  },
  fieldValueWrap: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    marginLeft: 4,
  },
  fieldValue: {
    fontSize: 12,
    fontFamily: fontFamily.bold,
    color: colors.gray800,
    textAlign: 'right',
    flexShrink: 1,
  },
  fieldValueEmpty: {
    color: colors.gray300,
    fontSize: 10,
    fontStyle: 'italic',
  },
  photoPlaceholderCenter: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyPhotoText: {
    fontSize: 7,
    fontFamily: fontFamily.bold,
    color: '#fca5a5',
    marginTop: 2,
  },
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fafafa',
  },
  leftActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  checkboxSmall: {
    width: 16,
    height: 16,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: colors.gray300,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  checkboxCheckedSmall: {
    backgroundColor: colors.brandPrimary,
    borderColor: colors.brandPrimary,
  },
  checkboxLabel: {
    fontSize: 12,
    fontFamily: fontFamily.semibold,
    color: colors.gray600,
  },
  rightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  editBtnWrap: {
    flexDirection: 'row',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.sm,
    backgroundColor: colors.gray100,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.gray200,
  },
  editBtnText: {
    fontSize: 11,
    fontFamily: fontFamily.bold,
    color: colors.gray600,
    textTransform: 'uppercase',
  },
  actionBtnGreen: {
    flexDirection: 'row',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.sm,
    backgroundColor: colors.verified.bg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.verified.border,
  },
  actionBtnTextGreen: {
    fontSize: 11,
    fontFamily: fontFamily.bold,
    color: colors.verified.text,
    textTransform: 'uppercase',
  },
  actionBtnRed: {
    flexDirection: 'row',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.sm,
    backgroundColor: colors.errorBg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.errorBorder,
  },
  actionBtnTextRed: {
    fontSize: 11,
    fontFamily: fontFamily.bold,
    color: colors.error,
    textTransform: 'uppercase',
  },
  actionBtnOrange: {
    flexDirection: 'row',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.sm,
    backgroundColor: colors.pending.bg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.pending.border,
  },
  actionBtnTextOrange: {
    fontSize: 11,
    fontFamily: fontFamily.bold,
    color: colors.pending.text,
    textTransform: 'uppercase',
  },
});

export default CardItem;
