import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, Animated, Dimensions, Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { DynamicIcon } from '../components/Icons';
import { useAuth } from '../context/AuthContext';
import Toast from '../components/Toast';
import { colors, gradients, typography, spacing, radius, shadows } from '../theme';

const { width } = Dimensions.get('window');

export default function MpinScreen({ navigation, route }) {
  const {
    isMpinCreated,
    createMpin,
    verifyMpin,
    changeMpin,
    forgotMpin,
    user,
  } = useAuth();

  // Screen modes: 'create' (force create on login), 'enter' (app lock screen), 'change' (from profile)
  const isChangeFlow = route?.params?.mode === 'change';
  const initialMode = isChangeFlow ? 'change' : (isMpinCreated ? 'enter' : 'create');

  const [mode, setMode] = useState(initialMode);
  
  // State machine steps:
  // For 'create': 'enter_new' | 'confirm_new'
  // For 'enter': 'enter_pin'
  // For 'change': 'enter_current' | 'enter_new' | 'confirm_new'
  const [step, setStep] = useState(() => {
    if (initialMode === 'create') return 'enter_new';
    if (initialMode === 'change') return 'enter_current';
    return 'enter_pin';
  });

  const [pin, setPin] = useState('');
  const [firstPin, setFirstPin] = useState(''); // Used to match in confirmation step
  const [currentPin, setCurrentPin] = useState(''); // Stores verified current PIN during change flow
  
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });

  // Animations
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const dotScales = [
    useRef(new Animated.Value(1)).current,
    useRef(new Animated.Value(1)).current,
    useRef(new Animated.Value(1)).current,
    useRef(new Animated.Value(1)).current,
  ];

  const showToast = (message, type = 'info') => {
    setToast({ visible: true, message, type });
  };

  // Pulse animation for the active/entered dots
  useEffect(() => {
    const len = pin.length;
    if (len > 0 && len <= 4) {
      Animated.sequence([
        Animated.timing(dotScales[len - 1], {
          toValue: 1.3,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.timing(dotScales[len - 1], {
          toValue: 1.0,
          duration: 100,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [pin]);

  // Shake animation for incorrect PIN entry
  const triggerShake = () => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start(() => setPin(''));
  };

  // Keypad actions
  const handlePressNumber = (num) => {
    if (pin.length < 4) {
      setPin(prev => prev + num);
    }
  };

  const handlePressDelete = () => {
    setPin(prev => prev.slice(0, -1));
  };

  // Process completed 4-digit entry
  useEffect(() => {
    if (pin.length === 4) {
      // Small timeout to let the 4th dot fill before processing
      const timer = setTimeout(() => {
        processPin(pin);
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [pin]);

  const processPin = async (enteredPin) => {
    setLoading(true);
    try {
      if (mode === 'create') {
        if (step === 'enter_new') {
          setFirstPin(enteredPin);
          setPin('');
          setStep('confirm_new');
          showToast('Please confirm your 4-digit MPIN', 'info');
        } else if (step === 'confirm_new') {
          if (enteredPin === firstPin) {
            const success = await createMpin(enteredPin);
            if (success) {
              showToast('MPIN created successfully', 'success');
              setTimeout(() => {
                navigation.reset({
                  index: 0,
                  routes: [{ name: 'Home' }],
                });
              }, 1500);
            } else {
              showToast('Failed to create MPIN', 'error');
              setStep('enter_new');
            }
          } else {
            showToast('MPINs do not match. Try again.', 'error');
            triggerShake();
            setStep('enter_new');
          }
        }
      } else if (mode === 'enter') {
        const isValid = await verifyMpin(enteredPin);
        if (isValid) {
          showToast('App unlocked successfully', 'success');
          setTimeout(() => {
            navigation.reset({
              index: 0,
              routes: [{ name: 'Home' }],
            });
          }, 1000);
        } else {
          showToast('Incorrect MPIN. Please try again.', 'error');
          triggerShake();
        }
      } else if (mode === 'change') {
        if (step === 'enter_current') {
          const isValid = await verifyMpin(enteredPin);
          if (isValid) {
            setCurrentPin(enteredPin);
            setPin('');
            setStep('enter_new');
            showToast('Enter your new 4-digit MPIN', 'info');
          } else {
            showToast('Incorrect current MPIN', 'error');
            triggerShake();
          }
        } else if (step === 'enter_new') {
          setFirstPin(enteredPin);
          setPin('');
          setStep('confirm_new');
          showToast('Confirm your new MPIN', 'info');
        } else if (step === 'confirm_new') {
          if (enteredPin === firstPin) {
            const success = await changeMpin(currentPin, enteredPin);
            if (success) {
              showToast('MPIN updated successfully', 'success');
              setTimeout(() => {
                navigation.goBack();
              }, 1000);
            } else {
              showToast('Failed to update MPIN', 'error');
              setStep('enter_current');
            }
          } else {
            showToast('MPINs do not match. Try again.', 'error');
            triggerShake();
            setStep('enter_new');
          }
        }
      }
    } catch (e) {
      showToast('An error occurred. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotMpin = () => {
    forgotMpin();
  };

  // Render title / subtitle dynamically based on state machine
  const getHeaderInfo = () => {
    if (mode === 'create') {
      if (step === 'enter_new') {
        return { title: 'Create MPIN', subtitle: 'Set a secure 4-digit MPIN for quick logins' };
      }
      return { title: 'Confirm MPIN', subtitle: 'Re-enter your 4-digit MPIN to confirm' };
    }
    if (mode === 'enter') {
      return { title: 'Enter MPIN', subtitle: `Welcome back, ${user?.name || 'User'}` };
    }
    // Change flow
    if (step === 'enter_current') {
      return { title: 'Verify Current MPIN', subtitle: 'Enter your existing 4-digit MPIN' };
    }
    if (step === 'enter_new') {
      return { title: 'New MPIN', subtitle: 'Enter your new secure 4-digit MPIN' };
    }
    return { title: 'Confirm New MPIN', subtitle: 'Re-enter your new MPIN to confirm' };
  };

  const header = getHeaderInfo();

  return (
    <LinearGradient
      colors={['#667eea', '#764ba2', '#5b21b6']}
      start={{ x: 0.3, y: 0 }}
      end={{ x: 0.7, y: 1 }}
      style={s.root}
    >
      <SafeAreaView style={s.safe}>
        {/* Top Spacer or Back Button */}
        <View style={s.topBar}>
          {isChangeFlow && (
            <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
              <DynamicIcon name="arrow-left" size={20} color={colors.white} />
            </TouchableOpacity>
          )}
        </View>

        {/* Brand / Header Section */}
        <View style={s.headerSection}>
          <View style={s.appIcon}>
            <DynamicIcon name="lock" size={24} color={colors.white} />
          </View>
          <Text style={s.title}>{header.title}</Text>
          <Text style={s.subtitle}>{header.subtitle}</Text>
        </View>

        {/* Dots Representation */}
        <Animated.View style={[s.dotsRow, { transform: [{ translateX: shakeAnim }] }]}>
          {[0, 1, 2, 3].map((idx) => {
            const isFilled = pin.length > idx;
            return (
              <Animated.View
                key={idx}
                style={[
                  s.dot,
                  isFilled && s.dotFilled,
                  { transform: [{ scale: dotScales[idx] }] }
                ]}
              />
            );
          })}
        </Animated.View>

        {/* Keyboard / Keypad */}
        <View style={s.keypadContainer}>
          <View style={s.keypadRow}>
            {['1', '2', '3'].map((n) => (
              <TouchableOpacity key={n} style={s.key} onPress={() => handlePressNumber(n)}>
                <Text style={s.keyText}>{n}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={s.keypadRow}>
            {['4', '5', '6'].map((n) => (
              <TouchableOpacity key={n} style={s.key} onPress={() => handlePressNumber(n)}>
                <Text style={s.keyText}>{n}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={s.keypadRow}>
            {['7', '8', '9'].map((n) => (
              <TouchableOpacity key={n} style={s.key} onPress={() => handlePressNumber(n)}>
                <Text style={s.keyText}>{n}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={s.keypadRow}>
            {/* Bottom-left key */}
            {mode === 'enter' ? (
              <TouchableOpacity style={[s.key, s.keySpecial]} onPress={handleForgotMpin}>
                <Text style={s.keySpecialText}>Forgot</Text>
              </TouchableOpacity>
            ) : isChangeFlow ? (
              <TouchableOpacity style={[s.key, s.keySpecial]} onPress={() => navigation.goBack()}>
                <Text style={s.keySpecialText}>Cancel</Text>
              </TouchableOpacity>
            ) : (
              <View style={s.key} />
            )}

            <TouchableOpacity style={s.key} onPress={() => handlePressNumber('0')}>
              <Text style={s.keyText}>0</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[s.key, s.keySpecial]} onPress={handlePressDelete}>
              <DynamicIcon name="backspace" size={18} color={colors.white} />
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>

      <Toast
        visible={toast.visible}
        message={toast.message}
        type={toast.type}
        onHide={() => setToast(prev => ({ ...prev, visible: false }))}
      />
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1, justifyContent: 'space-between' },
  topBar: {
    height: 50,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSection: {
    alignItems: 'center',
    paddingHorizontal: 30,
    marginTop: 20,
  },
  appIcon: {
    width: 60,
    height: 60,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    ...shadows.lg,
  },
  title: {
    color: colors.white,
    fontSize: 24,
    fontFamily: 'SairaSemiCondensed-Bold',
    textAlign: 'center',
  },
  subtitle: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 14,
    fontFamily: 'SairaSemiCondensed-Regular',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 24,
    marginVertical: 40,
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.5)',
    backgroundColor: 'transparent',
  },
  dotFilled: {
    backgroundColor: colors.white,
    borderColor: colors.white,
  },
  keypadContainer: {
    paddingHorizontal: 30,
    marginBottom: Platform.OS === 'ios' ? 10 : 30,
  },
  keypadRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 16,
  },
  key: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  keySpecial: {
    backgroundColor: 'transparent',
    borderWidth: 0,
  },
  keyText: {
    color: colors.white,
    fontSize: 28,
    fontFamily: 'SairaSemiCondensed-Bold',
  },
  keySpecialText: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 14,
    fontFamily: 'SairaSemiCondensed-Bold',
  },
});
