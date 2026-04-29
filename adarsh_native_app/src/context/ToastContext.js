import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity, Dimensions } from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import { colors, radius, shadows } from '../theme';

const { width } = Dimensions.get('window');
const ToastContext = createContext();

export const useToast = () => useContext(ToastContext);

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((message, type = 'error', duration = 3000) => {
    const id = Date.now() + Math.random();
    
    setToasts((prev) => {
      const newToasts = [...prev, { id, message, type }];
      if (newToasts.length > 2) return newToasts.slice(1);
      return newToasts;
    });

    setTimeout(() => {
      removeToast(id);
    }, duration);
  }, [removeToast]);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
};

const ToastContainer = ({ toasts, onRemove }) => {
  return (
    <View style={styles.container} pointerEvents="box-none">
      {toasts.map((toast, index) => (
        <ToastItem key={toast.id} toast={toast} index={index} onRemove={() => onRemove(toast.id)} />
      ))}
    </View>
  );
};

const ToastItem = ({ toast, onRemove }) => {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  React.useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  const isError = toast.type === 'error';
  const bgColor = isError ? '#1e1e2e' : '#fff';
  const textColor = isError ? '#fff' : colors.gray800;
  const iconColor = isError ? '#ef4444' : '#22c55e';

  return (
    <Animated.View style={[
      styles.toast, 
      { opacity: fadeAnim, transform: [{ translateY: slideAnim }], backgroundColor: bgColor }
    ]}>
      <FontAwesome5 
        name={isError ? 'exclamation-circle' : 'check-circle'} 
        size={14} 
        color={iconColor} 
        solid 
      />
      <Text style={[styles.text, { color: textColor }]} numberOfLines={2}>
        {toast.message}
      </Text>
      <TouchableOpacity onPress={onRemove} style={styles.close}>
        <FontAwesome5 name="times" size={10} color={isError ? 'rgba(255,255,255,0.4)' : colors.gray400} />
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 99999,
    gap: 8,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    width: width * 0.85,
    maxWidth: 340,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
    ...shadows.lg,
    gap: 12,
  },
  text: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'SairaSemiCondensed-Medium',
    lineHeight: 18,
  },
  close: {
    padding: 4,
  },
});
