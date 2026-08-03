import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, TouchableWithoutFeedback } from 'react-native';
import { DynamicIcon, IconWarning, IconArrowRight, IconClock, IconTrash, IconCheck, IconUsers, IconList } from './Icons';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, radius, shadows, fontFamily } from '../theme';

/**
 * Premium custom confirmation modal matching the website aesthetic.
 * Now supports status workflow visualization and notes.
 */
export default function ConfirmModal({ 
  visible, onClose, onConfirm, 
  title, message, confirmLabel = 'Confirm', 
  confirmColor = colors.brandPrimary, 
  icon = 'exclamation-triangle',
  loading = false,
  statusFrom = '',
  statusTo = '',
  note = '',
  noteIcon = 'info-circle'
}) {
  const getStatusColor = (status) => {
    const st = String(status || '').toLowerCase();
    if (st === 'pending') return '#f59e0b';
    if (st === 'verified') return '#10b981';
    if (st === 'approved') return '#3b82f6';
    if (st === 'download') return '#8b5cf6';
    if (st === 'pool') return '#ef4444';
    return confirmColor;
  };

  const fromColor = getStatusColor(statusFrom);
  const toColor = getStatusColor(statusTo);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.overlay}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={s.backdrop} />
        </TouchableWithoutFeedback>
        
        <View style={s.content}>
          <View style={[s.iconCircle, { backgroundColor: `${confirmColor}15`, borderColor: `${confirmColor}30` }]}>
            <ModalIcon name={icon} size={28} color={confirmColor} />
          </View>
          
          <Text style={s.title}>{title}</Text>
          <Text style={s.message}>{message}</Text>

          {(statusFrom || statusTo) && (
            <View style={s.statusFlow}>
              {statusFrom && (
                <View style={[s.statusBadge, { backgroundColor: `${fromColor}15`, borderColor: `${fromColor}30` }]}>
                  <Text style={[s.statusText, { color: fromColor }]}>{String(statusFrom || '').toUpperCase()}</Text>
                </View>
              )}
                <IconArrowRight size={10} color={colors.gray300} style={s.flowArrow} />
              {statusTo && (
                <View style={[s.statusBadge, { backgroundColor: `${toColor}15`, borderColor: `${toColor}30` }]}>
                  <Text style={[s.statusText, { color: toColor }]}>{String(statusTo || '').toUpperCase()}</Text>
                </View>
              )}
            </View>
          )}

          {note && (
            <View style={s.noteBox}>
              <IconClock size={10} color={colors.gray400} />
              <Text style={s.noteText}>{note}</Text>
            </View>
          )}
          
          <View style={s.footer}>
            <TouchableOpacity onPress={onClose} style={s.cancelBtn}>
              <Text style={s.cancelText}>Cancel</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              onPress={onConfirm} 
              disabled={loading}
              activeOpacity={0.8} 
              style={s.confirmBtnWrap}
            >
              <LinearGradient 
                colors={[confirmColor, confirmColor]} 
                style={s.confirmBtn}
              >
                <Text style={s.confirmText}>{loading ? 'Processing...' : confirmLabel}</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15, 23, 42, 0.75)' },
  content: { 
    width: '100%', 
    maxWidth: 340, 
    backgroundColor: '#fff', 
    borderRadius: radius.sm, 
    padding: 24, 
    alignItems: 'center',
    ...shadows.xl 
  },
  iconCircle: { 
    width: 70, 
    height: 70, 
    borderRadius: radius.sm, 
    borderWidth: 2, 
    alignItems: 'center', 
    justifyContent: 'center', 
    marginBottom: 16 
  },
  title: { 
    fontSize: 18, 
    fontFamily: 'SairaSemiCondensed-Bold', 
    color: colors.gray800, 
    textAlign: 'center', 
    marginBottom: 8 
  },
  message: { 
    fontSize: 13, 
    fontFamily: 'SairaSemiCondensed-Regular', 
    color: colors.gray500, 
    textAlign: 'center', 
    lineHeight: 18, 
    marginBottom: 16 
  },
  statusFlow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.xs, borderWidth: 1 },
  statusText: { fontSize: 9, fontFamily: 'SairaSemiCondensed-Bold', letterSpacing: 0.5 },
  flowArrow: { marginHorizontal: 2 },
  noteBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.gray50, padding: 10, borderRadius: radius.sm, marginBottom: 24, width: '100%' },
  noteText: { fontSize: 11, color: colors.gray500, flex: 1 },
  footer: { 
    flexDirection: 'row', 
    width: '100%', 
    columnGap: 12
  },
  cancelBtn: { 
    flex: 1, 
    paddingVertical: 14, 
    borderRadius: radius.sm, 
    backgroundColor: colors.gray100, 
    alignItems: 'center', 
    justifyContent: 'center' 
  },
  cancelText: { 
    fontSize: 13, 
    fontFamily: 'SairaSemiCondensed-SemiBold', 
    color: colors.gray600 
  },
  confirmBtnWrap: { 
    flex: 1.5, 
    borderRadius: radius.sm, 
    overflow: 'hidden' 
  },
  confirmBtn: { 
    paddingVertical: 14, 
    alignItems: 'center', 
    justifyContent: 'center' 
  },
  confirmText: { 
    fontSize: 13, 
    fontFamily: 'SairaSemiCondensed-Bold', 
    color: '#fff' 
  }
});

function ModalIcon({ name, size, color }) {
  return <DynamicIcon name={name} size={size} color={color} />;
}
