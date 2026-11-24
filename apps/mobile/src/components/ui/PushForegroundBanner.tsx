import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  colors,
  fontFamilies,
  radii,
  shadows,
  spacing,
  statusColors,
  typeScale,
  zIndex,
} from '@/theme';
import { PressableScale } from './PressableScale';

export interface PushForegroundBannerNotification {
  id?: string;
  title: string;
  body?: string;
  url?: string;
}

export interface PushForegroundBannerProps {
  notification: PushForegroundBannerNotification | null;
  onPress: () => void;
  onDismiss: () => void;
}

export function PushForegroundBanner({
  notification,
  onPress,
  onDismiss,
}: PushForegroundBannerProps) {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(-20)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!notification) return;
    translateY.setValue(-20);
    opacity.setValue(0);
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();
  }, [notification, opacity, translateY]);

  if (!notification) return null;

  const accessibilityLabel = notification.body
    ? `${notification.title}: ${notification.body}`
    : notification.title;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.overlay, { top: Math.max(insets.top, spacing.sm) + spacing.xs }]}
    >
      <Animated.View
        style={[
          styles.animatedWrap,
          {
            opacity,
            transform: [{ translateY }],
          },
        ]}
      >
        <PressableScale
          testID="push-foreground-banner"
          variant="card"
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          style={[styles.card, shadows.level3]}
        >
          <View style={styles.iconBadge}>
            <Ionicons name="notifications" size={20} color={colors.primaryDark} />
          </View>

          <View style={styles.textCol}>
            <Text style={styles.title} numberOfLines={2}>
              {notification.title}
            </Text>
            {notification.body ? (
              <Text style={styles.body} numberOfLines={2}>
                {notification.body}
              </Text>
            ) : null}
            <Text style={styles.actionHint}>לחצו לצפייה</Text>
          </View>

          <Pressable
            testID="push-foreground-banner-dismiss"
            onPress={(e) => {
              e.stopPropagation();
              onDismiss();
            }}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="סגור התראה"
            style={styles.dismissBtn}
          >
            <Ionicons name="close" size={18} color={colors.ink3} />
          </Pressable>
        </PressableScale>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    start: spacing.lg,
    end: spacing.lg,
    zIndex: zIndex.toast,
    alignItems: 'center',
  },
  animatedWrap: {
    width: '100%',
    maxWidth: 460,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    borderStartWidth: 4,
    borderStartColor: colors.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  iconBadge: {
    width: 38,
    height: 38,
    borderRadius: radii.pill,
    backgroundColor: statusColors.approvedBg,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  textCol: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontFamily: fontFamilies.bodyBold,
    fontSize: typeScale.step0,
    color: colors.ink,
    textAlign: 'left',
    includeFontPadding: false,
  },
  body: {
    fontFamily: fontFamilies.body,
    fontSize: typeScale.stepMinus1,
    color: colors.ink2,
    textAlign: 'left',
    lineHeight: 18,
  },
  actionHint: {
    fontFamily: fontFamilies.bodyMedium,
    fontSize: typeScale.stepMinus1,
    color: colors.primaryDark,
    textAlign: 'left',
    marginTop: 2,
    includeFontPadding: false,
  },
  dismissBtn: {
    width: 32,
    height: 32,
    borderRadius: radii.pill,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
});
