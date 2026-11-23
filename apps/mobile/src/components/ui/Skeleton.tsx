import React from 'react';
import {
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors, radii } from '@/theme';

interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

export function Skeleton({ width = '100%', height = 16, radius = radii.sm, style }: SkeletonProps) {
  return <View style={[styles.box, { width, height, borderRadius: radius }, style]} />;
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: colors.neutral,
    opacity: 0.75,
  },
});
