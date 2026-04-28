import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { FontAwesome5 } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { colors, gradients, typography, spacing, radius } from '../theme';

export default function TopBar({ title, subtitle, onBack, rightAction, children, showHome = true }) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute();

  // Don't show home button on Home screen itself
  const isHome = route.name === 'Home';
  const shouldShowHome = showHome && !isHome && onBack;

  const goHome = () => {
    navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
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
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  backBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleWrap: {
    flex: 1,
  },
  title: {
    color: colors.white,
    fontSize: typography.lg,
    fontFamily: 'SairaSemiCondensed-Bold',
  },
  subtitle: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: typography.xs,
    fontFamily: 'SairaSemiCondensed-Regular',
    marginTop: 1,
  },
  homeBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rightBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
