import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { FontAwesome5 } from '@expo/vector-icons';
import { IconArrowLeft, IconHome, IconDownload, IconPlus, IconSearch, IconFilter, IconList, IconUsers, IconSettings } from './Icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { colors, gradients, typography, spacing, radius, fontFamily } from '../theme';

export default function TopBar({ title, subtitle, onBack, rightAction, onAdd, onDownload, children, showHome = true }) {
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
        {rightAction && (
          <TouchableOpacity
            onPress={rightAction.onPress}
            style={styles.rightBtn}
            activeOpacity={0.7}
          >
            <RightIcon iconName={rightAction.icon} size={14} color={colors.white} />
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
    fontFamily: fontFamily.bold,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: typography.xs,
    fontFamily: fontFamily.medium,
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
  addBtn: {
    flexDirection: 'row',
    height: 32,
    paddingHorizontal: 10,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnText: {
    color: colors.white,
    fontSize: 10,
    fontFamily: fontFamily.bold,
  },
  downloadBtn: {
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

function RightIcon({ iconName, size, color }) {
  if (iconName === 'plus') return <IconPlus size={size} color={color} />;
  if (iconName === 'search') return <IconSearch size={size} color={color} />;
  if (iconName === 'filter') return <IconFilter size={size} color={color} />;
  if (iconName === 'settings') return <IconSettings size={size} color={color} />;
  return <IconPlus size={size} color={color} />; // Fallback
}
