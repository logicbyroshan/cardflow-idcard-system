import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { FontAwesome5 } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { colors, gradients, typography, spacing, radius, shadows } from '../theme';

export default function TopBar({ title, subtitle, onBack, rightAction, children, showHome = true }) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute();
  const { isAuthenticated } = useAuth();

  // Don't show home button on Home screen itself
  const isHome = route.name === 'Home';
  const shouldShowHome = showHome && !isHome && onBack;

  const goHome = () => {
    // If not authenticated, we reset to the Landing page
    const routeName = isAuthenticated ? 'Home' : 'Landing';
    navigation.reset({ index: 0, routes: [{ name: routeName }] });
  };

  return (
    <LinearGradient
      colors={gradients.brand}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={[styles.container, { paddingTop: insets.top + spacing.sm }]}
    >
      <View style={styles.inner}>
        {onBack && (
          <TouchableOpacity
            onPress={onBack}
            style={styles.backBtn}
            activeOpacity={0.7}
          >
            <FontAwesome5 name="arrow-left" size={14} color={colors.white} />
          </TouchableOpacity>
        )}
        <View style={styles.titleWrap}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          {subtitle && (
            <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>
          )}
        </View>
        {shouldShowHome && (
          <TouchableOpacity
            onPress={goHome}
            style={styles.homeBtn}
            activeOpacity={0.7}
          >
            <FontAwesome5 name="home" size={13} color={colors.white} solid />
          </TouchableOpacity>
        )}
        {rightAction && (
          <TouchableOpacity
            onPress={rightAction.onPress}
            style={styles.rightBtn}
            activeOpacity={0.7}
          >
            <FontAwesome5
              name={rightAction.icon}
              size={14}
              color={colors.white}
              solid={rightAction.solid !== false}
            />
          </TouchableOpacity>
        )}
      </View>
      {children}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.xl,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    ...shadows.lg,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleWrap: {
    flex: 1,
  },
  title: {
    color: colors.white,
    fontSize: 20,
    fontFamily: 'SairaSemiCondensed-Bold',
    letterSpacing: 0.5,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
    fontFamily: 'SairaSemiCondensed-Medium',
    marginTop: 2,
    letterSpacing: 0.3,
  },
  homeBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rightBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
