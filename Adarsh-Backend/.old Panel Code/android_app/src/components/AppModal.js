import React from 'react';
import { Modal, View, StyleSheet, TouchableOpacity, Platform, KeyboardAvoidingView } from 'react-native';
import { colors, radius, shadows } from '../theme';

export default function AppModal({
  visible,
  onClose,
  children,
  variant = 'sheet',
  dismissible = true,
}) {
  if (!visible) return null;

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.overlay}>
        {dismissible ? <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} /> : null}
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
          <View style={[styles.container, variant === 'center' ? styles.center : styles.sheet]}>
            {children}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  container: {
    backgroundColor: colors.white,
  },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    ...shadows.xl,
  },
  center: {
    marginHorizontal: 20,
    marginVertical: 40,
    borderRadius: radius.xl,
    ...shadows.xl,
  },
});
