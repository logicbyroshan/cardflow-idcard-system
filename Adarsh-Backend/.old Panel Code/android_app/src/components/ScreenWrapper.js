import React from 'react';
import { View, ScrollView, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';

export default function ScreenWrapper({
  children,
  scroll = false,
  style,
  contentStyle,
  keyboardAvoiding = false,
}) {
  const Container = scroll ? ScrollView : View;
  const containerProps = scroll ? { contentContainerStyle: [styles.content, contentStyle] } : { style: [styles.content, contentStyle] };

  const inner = (
    <Container {...containerProps}>
      {children}
    </Container>
  );

  return (
    <SafeAreaView style={[styles.safe, style]} edges={['top', 'left', 'right']}>
      {keyboardAvoiding ? (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
          {inner}
        </KeyboardAvoidingView>
      ) : inner}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.surfaceBg,
  },
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
  },
});
