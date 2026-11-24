import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamilies, radii, spacing, statusColors, typeScale } from '@/theme';

export function isNetStateOffline(state: NetInfoState | null | undefined): boolean {
  if (!state) return false;
  if (state.isConnected === false) return true;
  if (state.type === 'none') return true;
  return false;
}

export function useNetworkStatus(): { isOffline: boolean } {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    let active = true;

    NetInfo.fetch()
      .then((state) => {
        if (active) setIsOffline(isNetStateOffline(state));
      })
      .catch(() => {});

    const unsubscribe = NetInfo.addEventListener((state) => {
      if (active) setIsOffline(isNetStateOffline(state));
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return { isOffline };
}

interface OfflineBannerProps {
  isOffline?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function OfflineBanner({ isOffline: isOfflineProp, style }: OfflineBannerProps) {
  const { isOffline: detectedOffline } = useNetworkStatus();
  const offline = isOfflineProp !== undefined ? isOfflineProp : detectedOffline;

  if (!offline) return null;

  return (
    <View testID="offline-banner" accessibilityRole="alert" style={[styles.banner, style]}>
      <Ionicons name="cloud-offline-outline" size={18} color={colors.caution} />
      <Text style={styles.text}>מצב לא מקוון — השינויים יישמרו כשתחזרו לרשת</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: statusColors.pendingBg,
    borderWidth: 1,
    borderColor: colors.caution,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  text: {
    flex: 1,
    fontSize: typeScale.stepMinus1,
    fontFamily: fontFamilies.bodyMedium,
    color: colors.ink,
    textAlign: 'left',
    includeFontPadding: false,
    lineHeight: 20,
  },
});
