import {
  colors,
  fonts,
  layout,
  mobileTheme,
  motion,
  press,
  radii,
  semantic,
  shadows,
  typeScale,
  zIndex,
} from '@cookbook/tokens';
import {
  NotoSansHebrew_400Regular,
  NotoSansHebrew_500Medium,
  NotoSansHebrew_700Bold,
} from '@expo-google-fonts/noto-sans-hebrew';
import {
  NotoSerifHebrew_400Regular,
  NotoSerifHebrew_700Bold,
} from '@expo-google-fonts/noto-serif-hebrew';

export {
  colors,
  fonts,
  layout,
  mobileTheme,
  motion,
  press,
  radii,
  semantic,
  shadows,
  typeScale,
  zIndex,
};

export const FONT_ASSETS = {
  NotoSansHebrew_400Regular,
  NotoSansHebrew_500Medium,
  NotoSansHebrew_700Bold,
  NotoSerifHebrew_400Regular,
  NotoSerifHebrew_700Bold,
};

export const fontFamilies = {
  body: 'NotoSansHebrew_400Regular',
  bodyMedium: 'NotoSansHebrew_500Medium',
  bodyBold: 'NotoSansHebrew_700Bold',
  heading: 'NotoSerifHebrew_700Bold',
  headingRegular: 'NotoSerifHebrew_400Regular',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  '2xl': 32,
} as const;

export const statusColors = {
  pendingBg: '#fef3c7',
  pendingText: colors.caution,
  rejectedBg: '#fde8e8',
  rejectedText: colors.secondary,
  approvedBg: '#e8f3e3',
  approvedText: colors.primaryDark,
  sharedBg: colors.surface2,
  sharedText: colors.ink2,
  overlayBackdrop: 'rgba(31, 29, 24, 0.45)',
  darkScrim: 'rgba(31, 29, 24, 0.72)',
  whiteAlpha85: 'rgba(255, 255, 255, 0.85)',
} as const;

export default mobileTheme;
