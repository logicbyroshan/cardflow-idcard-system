import React, { lazy, Suspense } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
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

// Lazy load all other screens — they load on first navigation
const ProfileScreen = lazy(() => import('../screens/ProfileScreen'));
const NotificationsScreen = lazy(() => import('../screens/NotificationsScreen'));
const TablePickerScreen = lazy(() => import('../screens/TablePickerScreen'));
const NoAccessScreen = lazy(() => import('../screens/NoAccessScreen'));
const DesktopRequiredScreen = lazy(() => import('../screens/DesktopRequiredScreen'));
const SearchScreen = lazy(() => import('../screens/SearchScreen'));
const CardDetailScreen = lazy(() => import('../screens/CardDetailScreen'));
const GroupsScreen = lazy(() => import('../screens/GroupsScreen'));
const StaffManageScreen = lazy(() => import('../screens/StaffManageScreen'));
const SettingsScreen = lazy(() => import('../screens/SettingsScreen'));
const ClientsListScreen = lazy(() => import('../screens/ClientsListScreen'));
const CardListScreen = lazy(() => import('../screens/CardListScreen'));
const CardFormScreen = lazy(() => import('../screens/CardFormScreen'));
const CameraScreen = lazy(() => import('../screens/CameraScreen'));
const ReprintScreen = lazy(() => import('../screens/ReprintScreen'));
const ProductCategoryDetailScreen = lazy(() => import('../screens/ProductCategoryDetailScreen'));

const Stack = createNativeStackNavigator();

// Suspense fallback — minimal spinner
function LazyFallback() {
  return (
    <View style={fallbackStyles.root}>
      <ActivityIndicator size="large" color={colors.brandLight} />
    </View>
  );
}
const fallbackStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceBg, alignItems: 'center', justifyContent: 'center' },
});

// Wrap lazy screens with Suspense
function withSuspense(LazyComponent) {
  return function SuspenseWrapper(props) {
    return (
      <Suspense fallback={<LazyFallback />}>
        <LazyComponent {...props} />
      </Suspense>
    );
  };
}

// Pre-wrapped lazy screens
const LazyProfile = withSuspense(ProfileScreen);
const LazyNotifications = withSuspense(NotificationsScreen);
const LazyTablePicker = withSuspense(TablePickerScreen);
const LazyNoAccess = withSuspense(NoAccessScreen);
const LazyDesktopRequired = withSuspense(DesktopRequiredScreen);
const LazySearch = withSuspense(SearchScreen);
const LazyCardDetail = withSuspense(CardDetailScreen);
const LazyGroups = withSuspense(GroupsScreen);
const LazyStaffManage = withSuspense(StaffManageScreen);
const LazySettings = withSuspense(SettingsScreen);
const LazyClientsList = withSuspense(ClientsListScreen);
const LazyCardList = withSuspense(CardListScreen);
const LazyCardForm = withSuspense(CardFormScreen);
const LazyCamera = withSuspense(CameraScreen);
const LazyReprint = withSuspense(ReprintScreen);
const LazyProductCategoryDetail = withSuspense(ProductCategoryDetailScreen);

export default function AppNavigator() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) return null;

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          animationDuration: 200,
          gestureEnabled: true,
          fullScreenGestureEnabled: true,
          contentStyle: { backgroundColor: colors.surfaceBg },
        }}
      >
        {!isAuthenticated ? (
          <>
            <Stack.Screen name="Landing" component={LandingScreen} options={{ animation: 'fade' }} />
            <Stack.Screen name="ProductCategoryDetail" component={LazyProductCategoryDetail} />
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
            <Stack.Screen name="NoAccess" component={NoAccessScreen} />
            <Stack.Screen name="Welcome" component={WelcomeScreen} />
          </>
        ) : (
          <>
            <Stack.Screen name="Home" component={HomeScreen} options={{ animation: 'fade' }} />

            {/* Phase 1 */}
            <Stack.Screen name="Profile" component={LazyProfile} />
            <Stack.Screen name="Notifications" component={LazyNotifications} />
            <Stack.Screen name="TablePicker" component={LazyTablePicker} />
            <Stack.Screen name="NoAccess" component={LazyNoAccess} />
            <Stack.Screen name="DesktopRequired" component={LazyDesktopRequired} />

            {/* Phase 2 */}
            <Stack.Screen name="Search" component={LazySearch} />
            <Stack.Screen name="CardDetail" component={LazyCardDetail} />
            <Stack.Screen name="Groups" component={LazyGroups} />
            <Stack.Screen name="StaffManage" component={LazyStaffManage} />
            <Stack.Screen name="Settings" component={LazySettings} />
            <Stack.Screen name="ClientsList" component={LazyClientsList} />

            {/* Phase 3 */}
            <Stack.Screen name="CardList" component={LazyCardList} />
            <Stack.Screen name="CardForm" component={LazyCardForm} />
            <Stack.Screen name="Camera" component={LazyCamera} />
            <Stack.Screen name="Reprint" component={LazyReprint} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
