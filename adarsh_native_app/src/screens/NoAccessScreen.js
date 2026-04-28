import React from 'react';
import { View, StyleSheet } from 'react-native';
import TopBar from '../components/TopBar';
import { ErrorView, ERROR_TYPES } from '../components/NetworkGuard';
import { colors } from '../theme';

export default function NoAccessScreen({ navigation, route }) {
  const reason = route?.params?.reason || '';
  const isNoClient = reason === 'no-client-context';

  return (
    <View style={s.root}>
      <ErrorView
        type={ERROR_TYPES.PERMISSION}
        message={
          isNoClient
            ? 'Your account is not linked to any active client. Please contact your administrator.'
            : 'Mobile app access has not been enabled for your account. Please contact your administrator.'
        }
        onGoBack={isNoClient ? () => navigation.navigate('Home') : undefined}
        onRetry={!isNoClient ? () => navigation.navigate('Login') : undefined}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceBg },
});
