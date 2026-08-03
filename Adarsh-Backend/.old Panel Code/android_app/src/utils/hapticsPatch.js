import React from 'react';
import * as Haptics from 'expo-haptics';
import * as RN from 'react-native';

const triggerHaptic = () => {
  setTimeout(() => {
    try {
      if (Haptics && Haptics.impactAsync) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      }
    } catch (err) {
      // Ignore haptic errors to prevent any app crashes
    }
  }, 0);
};

const wrapComponent = (OriginalComponent, name) => {
  if (!OriginalComponent) return OriginalComponent;

  const WrappedComponent = React.forwardRef((props, ref) => {
    const { onPress, ...rest } = props;

    const handlePress = React.useCallback((event) => {
      triggerHaptic();
      if (onPress) {
        onPress(event);
      }
    }, [onPress]);

    return React.createElement(OriginalComponent, {
      ...rest,
      ref,
      onPress: onPress ? handlePress : undefined,
    });
  });

  // Copy static properties of original component
  try {
    Object.assign(WrappedComponent, OriginalComponent);
  } catch (e) {
    // Suppress errors for read-only properties
  }

  WrappedComponent.displayName = `HapticWrapped(${name || OriginalComponent.displayName || OriginalComponent.name || 'Component'})`;

  return WrappedComponent;
};

// Apply patch to react-native exports
try {
  if (RN.TouchableOpacity) {
    RN.TouchableOpacity = wrapComponent(RN.TouchableOpacity, 'TouchableOpacity');
  }
  if (RN.TouchableHighlight) {
    RN.TouchableHighlight = wrapComponent(RN.TouchableHighlight, 'TouchableHighlight');
  }
  if (RN.TouchableWithoutFeedback) {
    RN.TouchableWithoutFeedback = wrapComponent(RN.TouchableWithoutFeedback, 'TouchableWithoutFeedback');
  }
  if (RN.TouchableNativeFeedback) {
    RN.TouchableNativeFeedback = wrapComponent(RN.TouchableNativeFeedback, 'TouchableNativeFeedback');
  }
  if (RN.Pressable) {
    RN.Pressable = wrapComponent(RN.Pressable, 'Pressable');
  }
  console.log('[HapticPatch] Successfully applied global haptic feedback to react-native clickables.');
} catch (e) {
  console.error('[HapticPatch] Failed to apply global haptic feedback:', e);
}
