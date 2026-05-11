import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, TouchableWithoutFeedback } from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import { IconWarning, IconArrowRight, IconClock, IconTrash, IconCheck, IconUsers, IconList } from './Icons';
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
                <View style={[s.statusBadge, { backgroundColor: '#f59e0b15', borderColor: '#f59e0b30' }]}>
                  <Text style={[s.statusText, { color: '#f59e0b' }]}>{statusFrom.toUpperCase()}</Text>
                </View>
              )}
                <IconArrowRight size={10} color={colors.gray300} style={s.flowArrow} />
              {statusTo && (
                <View style={[s.statusBadge, { backgroundColor: `${confirmColor}15`, borderColor: `${confirmColor}30` }]}>
                  <Text style={[s.statusText, { color: confirmColor }]}>{statusTo.toUpperCase()}</Text>
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
    borderRadius: radius.lg, 
    padding: 24, 
    alignItems: 'center',
    ...shadows.xl 
  },
  iconCircle: { 
    width: 70, 
    height: 70, 
    borderRadius: 35, 
    borderWidth: 2, 
    alignItems: 'center', 
    justifyContent: 'center', 
    marginBottom: 16 
  },
  title: { 
    fontSize: 18, 
    fontFamily: fontFamily.bold, 
    color: colors.gray800, 
    textAlign: 'center', 
    marginBottom: 8 
  },
  message: { 
    fontSize: 13, 
    fontFamily: fontFamily.regular, 
    color: colors.gray500, 
    textAlign: 'center', 
    lineHeight: 18, 
    marginBottom: 16 
  },
  statusFlow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.xs, borderWidth: 1 },
  statusText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  flowArrow: { marginHorizontal: 2 },
  noteBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.gray50, padding: 10, borderRadius: radius.sm, marginBottom: 24, width: '100%' },
  noteText: { fontSize: 11, color: colors.gray500, flex: 1 },
  footer: { 
    flexDirection: 'row', 
    width: '100%', 
    
  },
  cancelBtn: { 
    flex: 1, 
    paddingVertical: 14, 
    borderRadius: radius.md, 
    backgroundColor: colors.gray100, 
    alignItems: 'center', 
    justifyContent: 'center' 
  },
  cancelText: { 
    fontSize: 13, 
    fontFamily: fontFamily.semibold, 
    color: colors.gray600 
  },
  confirmBtnWrap: { 
    flex: 1.5, 
    borderRadius: radius.md, 
    overflow: 'hidden' 
  },
  confirmBtn: { 
    paddingVertical: 14, 
    alignItems: 'center', 
    justifyContent: 'center' 
  },
  confirmText: { 
    fontSize: 13, 
    fontFamily: fontFamily.bold, 
    color: '#fff' 
  }
});

function ModalIcon({ name, size, color }) {
  if (name === 'trash-alt' || name === 'trash') return <IconTrash size={size} color={color} />;
  if (name === 'user-secret' || name === 'users' || name === 'user-minus') return <IconUsers size={size} color={color} />;
  if (name === 'check' || name === 'check-circle' || name === 'shield-alt') return <IconCheck size={size} color={color} />;
  if (name === 'layer-group') return <IconList size={size} color={color} />;
  return <IconWarning size={size} color={color} />; // Fallback
}
