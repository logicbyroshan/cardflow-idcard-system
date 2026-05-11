import React from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { DynamicIcon, IconClock, IconWarning, IconCheck } from './Icons';
import { colors, shadows, radius, spacing, typography, fontFamily } from '../theme';
import { HStack } from './Stack';
import { BASE_URL } from '../api/client';

const CardItem = React.memo(function CardItem({ item, showCheckbox, isSelected, onToggleSelect, onEdit, currentStatus, onStatusChange, onPool, onDelete, permissions = {} }) {
  const [imageErrors, setImageErrors] = React.useState({});
  const fd = item.field_data || {};
  const orderedFields = item.ordered_fields || [];
  let imageFields = [];
  let textFields = [];

  // 1. Process Fields
  if (orderedFields.length > 0) {
    orderedFields.forEach(f => {
      const val = fd[f.name] || '';
      if (f.type === 'image' || f.type === 'photo') {
        imageFields.push({ name: f.name, value: val });
      } else {
        textFields.push({ name: f.name, value: val });
      }
    });
  } else if (Object.keys(fd).length > 0) {
    Object.entries(fd).forEach(([key, value]) => {
      const k = key.toUpperCase();
      const v = String(value || '');
      const isImageKey = k.includes('PHOTO') || k.includes('SIGN') || k.includes('IMAGE');
      const isImageVal = v.match(/\.(jpg|jpeg|png|webp|gif)$/i) || v.startsWith('http') || v.startsWith('PENDING:') || v === 'NOT_FOUND';
      if (isImageKey || isImageVal) imageFields.push({ name: key, value: v });
      else textFields.push({ name: key, value: v });
    });
  } else {
    // Root-level fallbacks for search results (when field_data is not available)
    const commonFields = [
      { name: 'Name', keys: ['full_name', 'name', 'NAME', 'student_name'] },
      { name: 'Roll No', keys: ['roll_no', 'ROLL_NO', 'sr_no', 'id_number'] },
      { name: 'Mobile', keys: ['mobile', 'phone', 'MOBILE', 'PHONE'] },
      { name: 'Table', keys: ['table_name'] },
      { name: 'Group', keys: ['group_name'] },
    ];
    commonFields.forEach(cf => {
      const foundKey = cf.keys.find(k => item[k]);
      if (foundKey) textFields.push({ name: cf.name, value: item[foundKey] });
    });
  }

  // 2. Photo fallback
  if (imageFields.length === 0 && (item.photo_url || item.photo)) {
    imageFields.push({ name: 'PHOTO', value: item.photo_url || item.photo });
  }

  const hasPerm = (key) => {
    if (!permissions) return false;
    if (Array.isArray(permissions)) return permissions.includes(key);
    return !!permissions[key];
  };

  const renderImageStatus = (field) => {
    const val = String(field.value || '');
    const isPending = val.startsWith('PENDING:');
    const isEmpty = !val || val === 'NOT_FOUND' || val === 'null' || val === 'undefined';
    const isComplete = !isPending && !isEmpty;

    const isMainPhoto = field.name.toUpperCase() === 'PHOTO';
    
    let actualImageUrl = null;
    if (isComplete) {
      if (val.startsWith('http')) actualImageUrl = val;
      else if (val.startsWith('/media/')) actualImageUrl = `${BASE_URL}${val}`;
      else if (isMainPhoto && item.photo_url) {
        actualImageUrl = item.photo_url.startsWith('http') ? item.photo_url : `${BASE_URL}${item.photo_url}`;
      }
      else if (val.startsWith('file://') || val.startsWith('content://')) actualImageUrl = val;
    }

    const hasError = imageErrors[field.name];

    if (isPending) {
      bgColor = '#fef08a'; // YELLOW placeholder for pending
      iconName = 'clock';
      iconColor = '#ca8a04';
    } else if (isEmpty) {
      bgColor = '#f1f5f9'; // GREY placeholder
      iconName = 'user-alt-slash';
      iconColor = '#cbd5e1';
    } else if ((isComplete && !actualImageUrl) || hasError) {
      bgColor = '#fef08a'; // YELLOW placeholder for broken/missing
      iconName = 'exclamation-triangle';
      iconColor = '#ca8a04';
    }

    return (
      <View key={field.name} style={s.imgBoxWrap}>
        <View style={[s.imgBox, { backgroundColor: bgColor, borderColor: isEmpty ? '#e2e8f0' : colors.gray200 }]}>
          {actualImageUrl && !hasError ? (
            <Image 
              source={{ uri: actualImageUrl }} 
              style={s.actualImg} 
              onError={() => setImageErrors(prev => ({ ...prev, [field.name]: true }))}
            />
          ) : (
            <View style={s.photoPlaceholderCenter}>
               <DynamicIcon name={iconName} size={18} color={iconColor} />
              {isEmpty && <Text style={[s.emptyPhotoText, { color: '#94a3b8' }]}>EMPTY</Text>}
              {isPending && <Text style={[s.emptyPhotoText, { color: '#ca8a04' }]}>PENDING</Text>}
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
                {isSelected && <IconCheck size={8} color="#fff" />}
              </View>
              <Text style={[s.checkboxLabel, { marginLeft: 6 }]}>Select</Text>
            </TouchableOpacity>
          )}
        </View>
        <HStack spacing={8} style={s.rightActions}>
          {onEdit && hasPerm('perm_idcard_edit') && (
            <TouchableOpacity onPress={onEdit} style={s.editBtnWrap} activeOpacity={0.7}>
              <DynamicIcon name="edit" size={14} color={colors.brandPrimary} />
            </TouchableOpacity>
          )}

          {currentStatus === 'pending' && onStatusChange && hasPerm('perm_idcard_verify') && (
            <TouchableOpacity onPress={() => onStatusChange('verified')} style={s.actionBtnGreen} activeOpacity={0.7}>
              <Text style={s.actionBtnTextGreen}>Verify</Text>
            </TouchableOpacity>
          )}
          
          {currentStatus === 'verified' && onStatusChange && (
            <>
              {hasPerm('perm_idcard_approve') && (
                <TouchableOpacity onPress={() => onStatusChange('approved')} style={s.actionBtnGreen} activeOpacity={0.7}>
                  <Text style={s.actionBtnTextGreen}>Approve</Text>
                </TouchableOpacity>
              )}
              {hasPerm('perm_idcard_verify') && (
                <TouchableOpacity onPress={() => onStatusChange('pending')} style={s.actionBtnOrange} activeOpacity={0.7}>
                  <Text style={s.actionBtnTextOrange}>Unverify</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {currentStatus === 'approved' && onStatusChange && hasPerm('perm_idcard_approve') && (
            <TouchableOpacity onPress={() => onStatusChange('verified')} style={s.actionBtnOrange} activeOpacity={0.7}>
              <Text style={s.actionBtnTextOrange}>Unapprove</Text>
            </TouchableOpacity>
          )}

          {currentStatus === 'pool' && onStatusChange && hasPerm('perm_idcard_delete') && (
            <TouchableOpacity onPress={() => onStatusChange('pending')} style={s.actionBtnGreen} activeOpacity={0.7}>
              <Text style={s.actionBtnTextGreen}>Retrieve</Text>
            </TouchableOpacity>
          )}

          {onDelete && permissions.perm_idcard_delete && (
            <TouchableOpacity style={s.actionBtn} onPress={onDelete}>
              <DynamicIcon name="trash" size={14} color={colors.red} />
            </TouchableOpacity>
          )}
        </HStack>
      </View>
    </View>
  );
});

const s = StyleSheet.create({
  card: {
    width: '100%',
    backgroundColor: colors.white,
    borderRadius: radius.md,
    marginBottom: 12,
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
    paddingTop: 8,
    paddingLeft: 8,
    paddingBottom: 8,
    width: 68,
  },
  imgBoxWrap: {
    alignItems: 'center',
    width: 56,
    marginBottom: 6,
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
    padding: 8,
    paddingHorizontal: 8,
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
