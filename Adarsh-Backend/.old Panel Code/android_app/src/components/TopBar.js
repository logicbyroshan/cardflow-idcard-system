import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { DynamicIcon, IconArrowLeft, IconHome, IconDownload, IconPlus, IconSearch, IconFilter, IconList, IconUsers, IconSettings } from './Icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { colors, gradients, typography, spacing, radius, fontFamily } from '../theme';

export default function TopBar({ title, subtitle, onBack, rightAction, secondaryAction, onAdd, onDownload, children, showHome = true }) {
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
            <IconArrowLeft size={14} color={colors.white} />
          </TouchableOpacity>
        )}
        <View style={styles.titleWrap}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          {subtitle && (
            <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>
          )}
        </View>
        {onAdd && (
          <TouchableOpacity
            onPress={onAdd}
            style={styles.addBtn}
            activeOpacity={0.7}
          >
            <IconPlus size={10} color={colors.white} style={{ marginRight: 8 }} />
            <Text style={styles.addBtnText}>ADD</Text>
          </TouchableOpacity>
        )}
        {onDownload && (
          <TouchableOpacity
            onPress={onDownload}
            style={styles.downloadBtn}
            activeOpacity={0.7}
          >
            <IconDownload size={13} color={colors.white} />
          </TouchableOpacity>
        )}
        {shouldShowHome && (
          <TouchableOpacity
            onPress={goHome}
            style={styles.homeBtn}
            activeOpacity={0.7}
          >
            <IconHome size={13} color={colors.white} />
          </TouchableOpacity>
        )}
        {secondaryAction && (
          <TouchableOpacity
            onPress={secondaryAction.onPress}
            style={styles.rightBtn}
            activeOpacity={0.7}
          >
            <RightIcon iconName={secondaryAction.icon} size={13} color={colors.white} />
          </TouchableOpacity>
        )}
        {rightAction && (
          <TouchableOpacity
            onPress={rightAction.onPress}
            style={styles.rightBtn}
            activeOpacity={0.7}
          >
            <RightIcon iconName={rightAction.icon} size={13} color={colors.white} />
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
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  backBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
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
    fontFamily: 'SairaSemiCondensed-Medium',
    marginTop: 1,
  },
  homeBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  addBtn: {
    flexDirection: 'row',
    height: 32,
    paddingHorizontal: 10,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  addBtnText: {
    color: colors.white,
    fontSize: 10,
    fontFamily: 'SairaSemiCondensed-Bold',
  },
  downloadBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  rightBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
});

function RightIcon({ iconName, size, color }) {
  return <DynamicIcon name={iconName} size={size} color={color} />;
}
