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

const patchProps = (type, props) => {
  if (
    type === RN.TouchableOpacity || 
    type === RN.TouchableHighlight || 
    type === RN.TouchableWithoutFeedback || 
    type === RN.Pressable || 
    type === RN.TouchableNativeFeedback
  ) {
    if (props && props.onPress) {
      const originalOnPress = props.onPress;
      return {
        ...props,
        onPress: (e) => {
          triggerHaptic();
          if (originalOnPress) return originalOnPress(e);
        }
      };
    }
  }
  return props;
};

// Patch jsx and jsxs
try {
  const jsxRuntime = require('react/jsx-runtime');
  if (jsxRuntime) {
    const originalJsx = jsxRuntime.jsx;
    const originalJsxs = jsxRuntime.jsxs;

    if (originalJsx) {
      jsxRuntime.jsx = function(type, props, key) {
        return originalJsx.call(this, type, patchProps(type, props), key);
      };
    }
    if (originalJsxs) {
      jsxRuntime.jsxs = function(type, props, key) {
        return originalJsxs.call(this, type, patchProps(type, props), key);
      };
    }
  }
} catch (e) {
  console.log('[HapticPatch] Failed to patch jsx-runtime:', e);
}

// Also patch React.createElement as fallback
try {
  const originalCreateElement = React.createElement;
  React.createElement = function(type, props, ...children) {
    return originalCreateElement.call(this, type, patchProps(type, props), ...children);
  };
  console.log('[HapticPatch] Successfully applied global haptic feedback.');
} catch (e) {
  console.error('[HapticPatch] Failed to apply global haptic feedback:', e);
}
