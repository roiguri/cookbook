import React, { useRef } from 'react';
import {
  Animated,
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { press } from '@/theme';

export type PressScaleVariant = 'button' | 'icon' | 'card';

interface PressableScaleProps extends Omit<PressableProps, 'style'> {
  variant?: PressScaleVariant;
  haptic?: boolean;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const SCALE_MAP: Record<PressScaleVariant, number> = {
  button: press.scale,
  icon: press.scaleIcon,
  card: press.scaleCard,
};

export function PressableScale({
  variant = 'button',
  haptic = true,
  style,
  disabled,
  onPressIn,
  onPressOut,
  onPress,
  children,
  ...rest
}: PressableScaleProps) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const targetScale = SCALE_MAP[variant] ?? press.scale;

  const handlePressIn: PressableProps['onPressIn'] = (e) => {
    Animated.spring(scaleAnim, {
      toValue: targetScale,
      useNativeDriver: true,
      speed: 40,
      bounciness: 4,
    }).start();
    onPressIn?.(e);
  };

  const handlePressOut: PressableProps['onPressOut'] = (e) => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 35,
      bounciness: 6,
    }).start();
    onPressOut?.(e);
  };

  const handlePress: PressableProps['onPress'] = (e) => {
    if (haptic && !disabled) {
      Haptics.selectionAsync().catch(() => {});
    }
    onPress?.(e);
  };

  return (
    <AnimatedPressable
      disabled={disabled}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
      style={[style, { transform: [{ scale: scaleAnim }] }]}
      {...rest}
    >
      {children}
    </AnimatedPressable>
  );
}
