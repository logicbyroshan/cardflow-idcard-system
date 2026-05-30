import React, { lazy, Suspense } from 'react';
import { View, ActivityIndicator, StyleSheet, Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';
import { colors } from '../theme';

// Eagerly load auth screens (they're needed immediately)
import WelcomeScreen from '../screens/WelcomeScreen';
import LandingScreen from '../screens/LandingScreen';
import LoginScreen from '../screens/LoginScreen';
import ForgotPasswordScreen from '../screens/ForgotPasswordScreen';

// Eagerly load HomeScreen (primary authenticated screen)
import HomeScreen from '../screens/HomeScreen';
import MpinScreen from '../screens/MpinScreen';

import ProfileScreen from '../screens/ProfileScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import TablePickerScreen from '../screens/TablePickerScreen';
import NoAccessScreen from '../screens/NoAccessScreen';
import DesktopRequiredScreen from '../screens/DesktopRequiredScreen';
import SearchScreen from '../screens/SearchScreen';
import CardDetailScreen from '../screens/CardDetailScreen';
import GroupsScreen from '../screens/GroupsScreen';
import StaffManageScreen from '../screens/StaffManageScreen';
import ClientsListScreen from '../screens/ClientsListScreen';
import CardListScreen from '../screens/CardListScreen';
import CameraScreen from '../screens/CameraScreen';
import ReprintScreen from '../screens/ReprintScreen';
import ClientGroupsScreen from '../screens/ClientGroupsScreen';
import ReprintDetailScreen from '../screens/ReprintDetailScreen';
import PermissionsScreen from '../screens/PermissionsScreen';
import GroupSettingsScreen from '../screens/GroupSettingsScreen';
import KickedScreen from '../screens/KickedScreen';

const Stack = createNativeStackNavigator();


export default function AppNavigator() {
  const { isAuthenticated, isLoading, isAppUnlocked, isSessionKicked } = useAuth();

  if (isLoading) {
    return null;
  }

  if (isSessionKicked) {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Kicked" component={KickedScreen} />
      </Stack.Navigator>
    );
  }

  return (
    <Stack.Navigator
      initialRouteName={isAuthenticated ? (isAppUnlocked ? "Home" : "Mpin") : "Landing"}
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: colors.surfaceBg },
      }}
    >
      {!isAuthenticated ? (
        <>
          {/* Public/Auth Flow */}
          <Stack.Screen name="Landing" component={LandingScreen} />
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
          <Stack.Screen name="Welcome" component={WelcomeScreen} />
          <Stack.Screen name="NoAccess" component={NoAccessScreen} />
        </>
      ) : !isAppUnlocked ? (
        <>
          {/* Locked App Flow */}
          <Stack.Screen name="Mpin" component={MpinScreen} />
        </>
      ) : (
        <>
          {/* Main App Flow */}
          <Stack.Screen name="Home" component={HomeScreen} options={{ animation: 'fade' }} />
          
          {/* Landing still accessible but secondary */}
          <Stack.Screen name="Landing" component={LandingScreen} />
          <Stack.Screen name="NoAccess" component={NoAccessScreen} />
          
          {/* Management & Profile */}
          <Stack.Screen name="Profile" component={ProfileScreen} />
          <Stack.Screen name="Notifications" component={NotificationsScreen} />
          <Stack.Screen name="TablePicker" component={TablePickerScreen} />
          <Stack.Screen name="DesktopRequired" component={DesktopRequiredScreen} />
          <Stack.Screen name="StaffManage" component={StaffManageScreen} />
          <Stack.Screen name="ClientsList" component={ClientsListScreen} />
          <Stack.Screen name="Permissions" component={PermissionsScreen} />

          {/* Core Operations */}
          <Stack.Screen name="Search" component={SearchScreen} />
          <Stack.Screen name="CardList" component={CardListScreen} />
          <Stack.Screen name="CardDetail" component={CardDetailScreen} />
          <Stack.Screen name="Groups" component={GroupsScreen} />
          <Stack.Screen name="ClientGroups" component={ClientGroupsScreen} />
          <Stack.Screen name="Camera" component={CameraScreen} />
          <Stack.Screen name="Reprint" component={ReprintScreen} />
          <Stack.Screen name="ReprintDetail" component={ReprintDetailScreen} />
          <Stack.Screen name="GroupSettings" component={GroupSettingsScreen} />
          
          {/* Allowed to change MPIN when unlocked */}
          <Stack.Screen name="Mpin" component={MpinScreen} />
        </>
      )}
    </Stack.Navigator>
  );
}
