import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { apiPost } from '../api/client';

// Configure notification behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function registerForPushNotificationsAsync() {
  let token;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
    });
  }

  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    
    if (finalStatus !== 'granted') {
      console.warn('[PushNotification] Failed to get push token for push notification!');
      return null;
    }

    const projectId =
      Constants?.expoConfig?.extra?.eas?.projectId ??
      Constants?.easConfig?.projectId;

    const expoTokenObj = await Notifications.getExpoPushTokenAsync({
      projectId,
    });
    token = expoTokenObj.data;
    
    console.log('[PushNotification] Registered token:', token);
  } catch (e) {
    // Treat known Firebase-not-initialized errors as non-fatal (silent)
    try {
      const msg = (e && e.message) ? String(e.message) : '';
      if (msg.includes('Default FirebaseApp is not initialized') || msg.includes('Make sure to complete the guide at https://docs.expo.dev/push-notifications')) {
        console.info('[PushNotification] FCM not configured for this build — skipping token registration');
        return null;
      }
    } catch (__) {}
    console.warn('[PushNotification] Error getting push token:', e);
  }

  return token;
}

export async function registerDeviceTokenOnBackend(token) {
  if (!token) return;
  try {
    const { ok, data } = await apiPost('/api/mobile/device-token/register/', {
      push_token: token,
    });
    if (ok && data?.success) {
      console.log('[PushNotification] Token successfully registered on backend');
    } else {
      console.warn('[PushNotification] Failed to register token on backend:', data?.message);
    }
  } catch (e) {
    console.warn('[PushNotification] Error sending token to backend:', e);
  }
}export async function showLocalNotification(title, body) {
  try {
    if (!Notifications || typeof Notifications.scheduleNotificationAsync !== 'function') {
      console.warn('[PushNotification] scheduleNotificationAsync is not available');
      return;
    }
    
    // Request permission if not already granted
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    
    if (finalStatus === 'granted') {
      await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          sound: true,
        },
        trigger: null,
      });
    } else {
      console.warn('[PushNotification] Local notification permission denied');
    }
  } catch (e) {
    console.warn('[PushNotification] Error showing local notification:', e);
  }
}

