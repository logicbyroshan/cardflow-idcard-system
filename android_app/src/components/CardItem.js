import React from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { DynamicIcon, IconClock, IconWarning, IconCheck, IconEdit, IconTrash } from './Icons';
import { colors, shadows, radius, spacing, typography, fontFamily, gradients } from '../theme';
import { HStack } from './Stack';
import { cleanFieldValue } from '../utils/data';
import { LinearGradient } from 'expo-linear-gradient';
import { BASE_URL, getSessionCookies } from '../api/client';

const CardItem = React.memo(function CardItem({ 
  item, 
  showCheckbox, 
  isSelected, 
  onToggleSelect, 
  onEdit, 
  currentStatus, 
  onStatusChange, 
  onDelete, 
  permissions = {} 
}) {
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
        textFields.push({ name: f.name, value: val, label: f.label || f.name });
      }
    });
  } else {
    // Fallback if ordered_fields not available
    Object.entries(fd).forEach(([key, value]) => {
      const k = key.toUpperCase();
      const v = String(value || '');
      const isImage = k.includes('PHOTO') || k.includes('SIGN') || k.includes('IMAGE') || v.match(/\.(jpg|jpeg|png|webp|gif)$/i) || v.startsWith('http');
      if (isImage) imageFields.push({ name: key, value: v });
      else textFields.push({ name: key, value: v, label: key });
    });
  }

  // Ensure PHOTO is present if available at root and not already in imageFields
  const hasPhotoField = imageFields.some(img => img.name.toUpperCase() === 'PHOTO');
  if (!hasPhotoField && (item.photo_url || item.photo)) {
    imageFields.unshift({ name: 'PHOTO', value: item.photo_url || item.photo });
  }

  const hasPerm = (key) => !!permissions[key];

  const renderImage = (field) => {
    const val = String(field.value || '');
    const isPending = val.toUpperCase().startsWith('PENDING') || val.toUpperCase().includes('PENDING:');
    const isEmpty = !val || val === 'NOT_FOUND' || val === 'null' || val === 'undefined' || val.trim() === '';
    const hasError = imageErrors[field.name];
    
    let imageUrl = null;
    if (!isPending && !isEmpty) {
      if (val.startsWith('http') || val.startsWith('file://') || val.startsWith('content://') || val.startsWith('data:image')) {
        imageUrl = val;
      } else if (val.startsWith('/media/')) {
        imageUrl = `${BASE_URL}${val}`;
      } else if (val.startsWith('media/')) {
        imageUrl = `${BASE_URL}/${val}`;
      } else if (val.includes('/media/')) {
        const idx = val.indexOf('/media/');
        imageUrl = `${BASE_URL}${val.substring(idx)}`;
      } else if (val.includes('media/')) {
        const idx = val.indexOf('media/');
        imageUrl = `${BASE_URL}/${val.substring(idx)}`;
      } else {
        imageUrl = val.startsWith('/') ? `${BASE_URL}${val}` : `${BASE_URL}/${val}`;
      }
    }

    const showImage = !isPending && !isEmpty && imageUrl && !hasError;
    
    let boxBg = '#f1f5f9';
    let iconName = 'user-slash';
    let iconColor = '#cbd5e1';

    if (isPending) {
      boxBg = '#fef08a';
      iconName = 'clock';
      iconColor = '#ca8a04';
    } else if (showImage) {
      boxBg = '#fff';
    }

    return (
      <View key={field.name} style={s.imgBoxWrap}>
        <View style={[s.imgBox, { backgroundColor: boxBg }]}>
          {showImage ? (
            <Image 
              source={{ 
                uri: imageUrl,
                headers: {
                  Cookie: getSessionCookies()
                }
              }} 
              style={s.actualImg} 
              onError={() => setImageErrors(p => ({ ...p, [field.name]: true }))}
            />
          ) : (
            <DynamicIcon 
              name={iconName} 
              size={16} 
              color={iconColor} 
            />
          )}
        </View>
        <Text style={s.imgBoxLabel} numberOfLines={1}>{field.name}</Text>
      </View>
    );
  };

  return (
    <View style={[s.card, isSelected && s.cardSelected]}>
      <View style={s.cardBody}>
        <View style={s.imagesColumn}>
          {imageFields.map(renderImage)}
        </View>

        <View style={s.fieldsList}>
          {textFields.map((f, i) => (
            <View key={f.name} style={[s.fieldRow, i === 0 && { borderTopWidth: 0 }]}>
              <Text style={s.fieldLabel} numberOfLines={1}>{f.label}</Text>
              <Text style={s.fieldValue} numberOfLines={1}>{cleanFieldValue(f.value) || '-'}</Text>
            </View>
          ))}
          {textFields.length === 0 && (
            <View style={s.emptyData}><Text style={s.emptyDataText}>No data</Text></View>
          )}
        </View>
      </View>

      <View style={s.cardActions}>
        <View style={s.leftActions}>
          {showCheckbox && (
            <TouchableOpacity onPress={() => onToggleSelect(item.id)} style={s.checkboxRow}>
              <View style={[s.checkboxSmall, isSelected && s.checkboxCheckedSmall]}>
                {isSelected && <DynamicIcon name="check" size={8} color="#fff" />}
              </View>
              <Text style={s.checkboxLabel}>SELECT</Text>
            </TouchableOpacity>
          )}
        </View>

        <HStack spacing={8} style={s.rightActions}>
          {/* Pending List Action Button */}
          {currentStatus === 'pending' && onStatusChange && hasPerm('perm_idcard_verify') && (
            <TouchableOpacity 
              style={[s.outlineBtn, { borderColor: colors.green }]} 
              onPress={() => onStatusChange('verified')}
            >
              <Text style={[s.outlineBtnText, { color: colors.green }]}>VERIFY</Text>
            </TouchableOpacity>
          )}

          {/* Verified List Action Buttons */}
          {currentStatus === 'verified' && onStatusChange && (
            <>
              {hasPerm('perm_idcard_approve') && (
                <TouchableOpacity 
                  style={[s.outlineBtn, { borderColor: colors.green }]} 
                  onPress={() => onStatusChange('approved')}
                >
                  <Text style={[s.outlineBtnText, { color: colors.green }]}>APPROVE</Text>
                </TouchableOpacity>
              )}
              {hasPerm('perm_idcard_verify') && (
                <TouchableOpacity 
                  style={[s.outlineBtn, { borderColor: colors.red }]} 
                  onPress={() => onStatusChange('pending')}
                >
                  <Text style={[s.outlineBtnText, { color: colors.red }]}>UNVERIFY</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {/* Approved List Action Button */}
          {currentStatus === 'approved' && onStatusChange && hasPerm('perm_idcard_approve') && (
            <TouchableOpacity 
              style={[s.outlineBtn, { borderColor: colors.red }]} 
              onPress={() => onStatusChange('verified')}
            >
              <Text style={[s.outlineBtnText, { color: colors.red }]}>DISAPPROVE</Text>
            </TouchableOpacity>
          )}

          {/* Download List Action Button */}
          {currentStatus === 'download' && onStatusChange && hasPerm('perm_idcard_retrieve') && (
            <TouchableOpacity 
              style={[s.outlineBtn, { borderColor: colors.brandPrimary }]} 
              onPress={() => onStatusChange('pending')}
            >
              <Text style={[s.outlineBtnText, { color: colors.brandPrimary }]}>RETRIEVE</Text>
            </TouchableOpacity>
          )}

          {/* Pool List Action Button */}
          {currentStatus === 'pool' && onStatusChange && hasPerm('perm_idcard_retrieve') && (
            <TouchableOpacity 
              style={[s.outlineBtn, { borderColor: colors.brandPrimary }]} 
              onPress={() => onStatusChange('pending')}
            >
              <Text style={[s.outlineBtnText, { color: colors.brandPrimary }]}>RETRIEVE</Text>
            </TouchableOpacity>
          )}

          {/* Edit Button */}
          {onEdit && hasPerm('perm_idcard_edit') && (
            <TouchableOpacity style={s.iconBtn} onPress={() => onEdit(item)}>
              <IconEdit size={12} color={colors.brandPrimary} />
            </TouchableOpacity>
          )}

          {/* Delete/Pool Button */}
          {onDelete && hasPerm('perm_idcard_delete') && (
            <TouchableOpacity style={s.iconBtn} onPress={() => onDelete(item)}>
              <IconTrash size={12} color={colors.red} />
            </TouchableOpacity>
          )}
        </HStack>
      </View>
    </View>
  );
});

const s = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: radius.xs, marginHorizontal: 12, marginBottom: 10, borderWidth: 1, borderColor: '#f1f5f9', ...shadows.sm, overflow: 'hidden' },
  cardSelected: { borderColor: colors.brandPrimary, backgroundColor: '#f8fafc' },
  cardBody: { flexDirection: 'row', padding: 8 },
  imagesColumn: { width: 50, gap: 10, marginRight: 12 },
  imgBoxWrap: { alignItems: 'center' },
  imgBox: { width: 50, height: 60, borderRadius: radius.xs, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#f1f5f9' },
  actualImg: { width: '100%', height: '100%', resizeMode: 'cover' },
  imgBoxLabel: { fontSize: 7, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray400, marginTop: 2, textTransform: 'uppercase' },
  fieldsList: { flex: 1, justifyContent: 'center' },
  fieldRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2, borderBottomWidth: 1, borderBottomColor: '#f8fafc' },
  fieldLabel: { fontSize: 9, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray400, textTransform: 'uppercase' },
  fieldValue: { fontSize: 11, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray800, flex: 1, textAlign: 'right', marginLeft: 10 },
  emptyData: { padding: 10, alignItems: 'center' },
  emptyDataText: { fontSize: 10, fontFamily: 'SairaSemiCondensed-Medium', color: colors.gray300, fontStyle: 'italic' },
  cardActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10, paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#f1f5f9', backgroundColor: '#fafafa' },
  leftActions: { flexDirection: 'row', alignItems: 'center' },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  checkboxSmall: { width: 14, height: 14, borderRadius: radius.xs, borderWidth: 1, borderColor: colors.gray300, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  checkboxCheckedSmall: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  checkboxLabel: { fontSize: 10, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray500 },
  rightActions: { flexDirection: 'row', alignItems: 'center' },
  iconBtn: { width: 30, height: 30, borderRadius: radius.xs, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: '#f1f5f9' },
  premiumBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.xs, alignItems: 'center', justifyContent: 'center' },
  premiumBtnText: { fontSize: 9, fontFamily: 'SairaSemiCondensed-Bold', color: '#fff' },
  outlineBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.xs, borderWidth: 1, borderColor: '#e2e8f0', backgroundColor: '#fff' },
  outlineBtnText: { fontSize: 9, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray600 },
});

export default CardItem;
