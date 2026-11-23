import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, fontFamilies, radii, statusColors, typeScale } from '@/theme';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'primary';

interface BadgeProps {
  label: string;
  tone?: BadgeTone;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function Badge({ label, tone = 'neutral', testID, style }: BadgeProps) {
  return (
    <View testID={testID} style={[styles.badge, styles[`tone_${tone}`], style]}>
      <Text style={[styles.text, styles[`text_${tone}`]]} allowFontScaling={false}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingVertical: 3,
    paddingHorizontal: 10,
    borderRadius: radii.pill,
    alignSelf: 'flex-start',
  },
  tone_neutral: {
    backgroundColor: statusColors.sharedBg,
  },
  tone_success: {
    backgroundColor: statusColors.approvedBg,
  },
  tone_warning: {
    backgroundColor: statusColors.pendingBg,
  },
  tone_danger: {
    backgroundColor: statusColors.rejectedBg,
  },
  tone_primary: {
    backgroundColor: colors.primary,
  },
  text: {
    fontSize: 12,
    fontFamily: fontFamilies.bodyBold,
    includeFontPadding: false,
  },
  text_neutral: {
    color: statusColors.sharedText,
  },
  text_success: {
    color: statusColors.approvedText,
  },
  text_warning: {
    color: statusColors.pendingText,
  },
  text_danger: {
    color: statusColors.rejectedText,
  },
  text_primary: {
    color: colors.buttonColor,
  },
});
