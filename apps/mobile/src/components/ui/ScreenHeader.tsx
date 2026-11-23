import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fontFamilies, spacing, typeScale } from '@/theme';

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  rightAction?: React.ReactNode;
  testID?: string;
}

export function ScreenHeader({ title, subtitle, rightAction, testID }: ScreenHeaderProps) {
  return (
    <View testID={testID} style={styles.row}>
      <View style={styles.textCol}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {rightAction ? <View style={styles.action}>{rightAction}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.md,
  },
  textCol: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: typeScale.step3,
    fontFamily: fontFamilies.heading,
    fontWeight: '700',
    color: colors.ink,
    textAlign: 'left',
  },
  subtitle: {
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.body,
    color: colors.ink3,
    textAlign: 'left',
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
});
