import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radii, shadows, spacing } from '@/theme';
import { PressableScale } from './PressableScale';

interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  testID?: string;
  elevated?: boolean;
}

export function Card({ children, style, onPress, testID, elevated = true }: CardProps) {
  const cardStyle = [styles.card, elevated && shadows.level1, style];
  if (onPress) {
    return (
      <PressableScale variant="card" onPress={onPress} testID={testID} style={cardStyle}>
        {children}
      </PressableScale>
    );
  }
  return (
    <View testID={testID} style={cardStyle}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.hairline,
    padding: spacing.lg,
  },
});
