/**
 * Adarsh ID Cards — Native App Theme
 * Matches the WEBSITE brand colors.
 * Website primary: #667eea → #764ba2 gradient
 *
 * DESIGN RULES:
 * - Very low border radius everywhere (4–6px max)
 * - Saira SemiCondensed font forced globally
 * - Consistent spacing, icons, and color tokens
 */

export const colors = {
  // Brand — exact website gradient endpoints
  brandPrimary: '#667eea',
  brandPrimaryDark: '#5a67d8',
  brandPrimaryLight: '#818cf8',
  brandSecondary: '#764ba2',
  brandSecondaryDark: '#5b21b6',

  // Legacy aliases
  brand: '#667eea',
  brandLight: '#667eea',
  brandDark: '#764ba2',

  // Surfaces
  surfaceBg: '#f4f4f4',
  white: '#ffffff',
  black: '#000000',

  // Text
  textPrimary: '#2c3e50',
  textSecondary: '#666666',
  textMuted: '#888888',
  textLight: '#aaaaaa',

  // Action colors
  blue: '#3b82f6',
  blueDark: '#2563eb',
  green: '#22c55e',
  greenDark: '#16a34a',
  red: '#ef4444',
  redDark: '#dc2626',
  yellow: '#f59e0b',
  yellowDark: '#d97706',
  purple: '#8b5cf6',
  purpleDark: '#7c3aed',
  teal: '#06b6d4',
  tealDark: '#0891b2',

  // Status
  pending: { bg: '#fef3c7', text: '#b45309', border: '#fde68a', icon: '#f59e0b' },
  verified: { bg: '#d1fae5', text: '#047857', border: '#a7f3d0', icon: '#10b981' },
  approved: { bg: '#dbeafe', text: '#2563eb', border: '#bfdbfe', icon: '#3b82f6' },
  download: { bg: '#ede9fe', text: '#7c3aed', border: '#ddd6fe', icon: '#8b5cf6' },
  pool: { bg: '#fef2f2', text: '#dc2626', border: '#fecaca', icon: '#ef4444' },
  total: { bg: '#f1f5f9', text: '#334155', border: '#e2e8f0', icon: '#475569' },

  // UI feedback
  success: '#22c55e',
  error: '#ef4444',
  errorBg: '#fef2f2',
  errorBorder: '#fecaca',
  warning: '#f59e0b',
  info: '#3b82f6',

  // Grays
  gray50: '#f8fafc',
  gray100: '#f1f5f9',
  gray200: '#e2e8f0',
  gray300: '#cbd5e1',
  gray400: '#94a3b8',
  gray500: '#64748b',
  gray600: '#475569',
  gray700: '#334155',
  gray800: '#1e293b',
  gray900: '#0f172a',

  // Indigo
  indigo50: '#eef2ff',
  indigo100: '#e0e7ff',
  indigo200: '#c7d2fe',

  // Dark
  sidebarBg: '#1e1e2e',

  // Overlay
  overlay: 'rgba(0,0,0,0.35)',
  glassBg: 'rgba(255,255,255,0.85)',
  glassBorder: 'rgba(255,255,255,0.25)',
  darkGlassBg: 'rgba(15,23,42,0.75)',
  darkGlassBorder: 'rgba(255,255,255,0.1)',

  // Status glass
  pendingGlass: 'rgba(245,158,11,0.08)',
  verifiedGlass: 'rgba(16,185,129,0.08)',
  approvedGlass: 'rgba(59,130,246,0.08)',
  downloadGlass: 'rgba(139,92,246,0.08)',
  poolGlass: 'rgba(236,72,153,0.08)',
};

export const roleThemes = {
  super_admin: {
    primary: '#f43f5e', secondary: '#e11d48',
    bgSoft: '#fff1f2', text: '#9f1239',
    gradient: ['#f43f5e', '#e11d48'],
    surface: ['#fff1f2', '#ffe4e6'],
  },
  admin_staff: {
    primary: '#8b5cf6', secondary: '#7c3aed',
    bgSoft: '#f5f3ff', text: '#5b21b6',
    gradient: ['#8b5cf6', '#7c3aed'],
    surface: ['#f5f3ff', '#ede9fe'],
  },
  client: {
    primary: '#3b82f6', secondary: '#2563eb',
    bgSoft: '#eff6ff', text: '#1e40af',
    gradient: ['#3b82f6', '#2563eb'],
    surface: ['#eff6ff', '#dbeafe'],
  },
  pro_user: {
    primary: '#3b82f6', secondary: '#2563eb',
    bgSoft: '#eff6ff', text: '#1e40af',
    gradient: ['#3b82f6', '#2563eb'],
    surface: ['#eff6ff', '#dbeafe'],
  },
  client_staff: {
    primary: '#10b981', secondary: '#059669',
    bgSoft: '#ecfdf5', text: '#065f46',
    gradient: ['#10b981', '#059669'],
    surface: ['#ecfdf5', '#d1fae5'],
  },
  default: {
    primary: colors.brandPrimary, secondary: colors.brandSecondary,
    bgSoft: colors.indigo50, text: colors.brandSecondaryDark,
    gradient: [colors.brandPrimary, colors.brandSecondary],
    surface: ['#f8fafc', '#eff6ff'],
  },
};

export const gradients = {
  brand: [colors.brandPrimary, colors.brandSecondary],
  brandFull: [colors.brandPrimary, colors.brandSecondary, colors.brandSecondaryDark],
  dark: ['#1e1e2e', '#2d2d44'],
  surface: [colors.gray50, colors.indigo50, '#f0f9ff'],
};

export const spacing = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32,
};

// ── VERY LOW border radius — uniform across entire app ──
export const radius = {
  xs: 1,
  sm: 2,
  md: 4,
  lg: 6,
  xl: 8,
  xxl: 12,
  full: 999,
};

// ── Forced font family — Saira SemiCondensed everywhere ──
export const fontFamily = {
  regular: 'SairaSemiCondensed-Regular',
  medium: 'SairaSemiCondensed-Medium',
  semibold: 'SairaSemiCondensed-SemiBold',
  bold: 'SairaSemiCondensed-Bold',
  extrabold: 'SairaSemiCondensed-Bold', // Fallback to Bold
  black: 'SairaSemiCondensed-Bold',     // Fallback to Bold
};

export const typography = {
  xxxs: 8, xxs: 9, xs: 10, sm: 11, md: 12, base: 13,
  lg: 14, xl: 16, xxl: 18, xxxl: 20, title: 24,
  regular: '400', medium: '500', semibold: '600',
  bold: '700', extrabold: '800', black: '900',
};

export const shadows = {
  sm: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
  md: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 3 },
  lg: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 8, elevation: 5 },
  xl: { shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 16, elevation: 8 },
};
