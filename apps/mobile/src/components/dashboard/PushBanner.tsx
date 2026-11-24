import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamilies, radii, shadows, spacing, statusColors, typeScale } from '@/theme';
import { Button, PressableScale, useToast } from '@/components/ui';
import {
  NotificationService,
  PUSH_STATUS_ACTIVE_LABEL,
  type PushPermissionStatus,
} from '@/services/users/notification-service';

export interface PushBannerProps {
  uid: string;
}

export function PushBanner({ uid }: PushBannerProps) {
  const { showToast } = useToast();
  const [status, setStatus] = useState<PushPermissionStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const loadStatus = useCallback(async () => {
    if (!uid) {
      setStatus(null);
      return;
    }
    const next = await NotificationService.getStatus(uid);
    setStatus(next);
  }, [uid]);

  useEffect(() => {
    void loadStatus();
    const unsub = NotificationService.subscribeStatusChange(() => {
      void loadStatus();
    });
    return unsub;
  }, [loadStatus]);

  const handleEnable = useCallback(async () => {
    if (!uid || busy) return;
    setBusy(true);
    try {
      const result = await NotificationService.enable(uid);
      setStatus(result.status);
      if (result.ok) {
        showToast('התראות הופעלו במכשיר זה', 'success');
      } else if (result.reason === 'denied') {
        showToast('המכשיר חסם את ההתראות. ניתן לאפשר אותן בהגדרות המכשיר.', 'error', 4200);
      } else {
        showToast('הפעלת ההתראות נכשלה. נסו שוב.', 'error');
      }
    } finally {
      setBusy(false);
    }
  }, [uid, busy, showToast]);

  const handleOptOut = useCallback(async () => {
    if (!uid || busy) return;
    setBusy(true);
    try {
      const result = await NotificationService.disable(uid);
      setStatus(result.status);
      setDismissed(false);
      if (result.ok) {
        showToast('ההתראות כובו במכשיר זה', 'info');
      }
    } finally {
      setBusy(false);
    }
  }, [uid, busy, showToast]);

  if (!status || status === 'unsupported') {
    return null;
  }

  if (dismissed && status !== 'granted-registered') {
    return null;
  }

  if (status === 'granted-registered') {
    return (
      <View
        testID="dashboard-push-banner"
        collapsable={false}
        style={[styles.banner, styles.bannerActive]}
      >
        <View style={styles.topRow}>
          <View style={[styles.iconWrap, styles.iconWrapActive]}>
            <Ionicons name="notifications" size={20} color={colors.primaryDark} />
          </View>
          <View style={styles.textCol}>
            <Text testID="push-permission-status" style={styles.activeTitle}>
              {PUSH_STATUS_ACTIVE_LABEL}
            </Text>
            <Text style={styles.subtitle}>קבל התראה מיידית כשמתכון חדש ממתין לאישור</Text>
          </View>
          <Button
            testID="push-opt-out-btn"
            label="כבה התראות"
            variant="secondary"
            size="sm"
            loading={busy}
            onPress={() => {
              void handleOptOut();
            }}
          />
        </View>
      </View>
    );
  }

  if (status === 'denied') {
    return (
      <View
        testID="dashboard-push-banner"
        collapsable={false}
        style={[styles.banner, styles.bannerMuted]}
      >
        <View style={styles.topRow}>
          <View style={styles.iconWrap}>
            <Ionicons name="notifications-off-outline" size={20} color={colors.ink3} />
          </View>
          <View style={styles.textCol}>
            <Text testID="push-permission-status" style={styles.title}>
              התראות חסומות בהגדרות המכשיר
            </Text>
            <Text style={styles.subtitle}>
              כדי לקבל התראה מיידית כשמתכון חדש ממתין לאישור, אפשרו התראות בהגדרות המכשיר.
            </Text>
          </View>
          <PressableScale
            testID="dashboard-push-dismiss-btn"
            variant="icon"
            onPress={() => setDismissed(true)}
            accessibilityLabel="סגור"
            style={styles.dismissIconBtn}
          >
            <Ionicons name="close" size={18} color={colors.ink3} />
          </PressableScale>
        </View>
      </View>
    );
  }

  // 'default' | 'granted-unregistered'
  return (
    <View testID="dashboard-push-banner" collapsable={false} style={styles.banner}>
      <View style={styles.topRow}>
        <View style={styles.iconWrap}>
          <Ionicons name="notifications-outline" size={20} color={colors.primaryDark} />
        </View>
        <View style={styles.textCol}>
          <Text style={styles.title}>קבל התראה מיידית כשמתכון חדש ממתין לאישור</Text>
          <Text testID="push-permission-status" style={styles.statusSubtle}>
            התראות לא מופעלות במכשיר זה
          </Text>
        </View>
      </View>

      <View style={styles.actionsRow}>
        <Button
          testID="dashboard-push-enable-btn"
          label={busy ? 'מפעיל...' : 'הפעל התראות במכשיר זה'}
          variant="primary"
          size="sm"
          loading={busy}
          onPress={() => {
            void handleEnable();
          }}
          style={styles.enableBtn}
        />
        <Button
          testID="dashboard-push-dismiss-btn"
          label="סגור"
          variant="ghost"
          size="sm"
          disabled={busy}
          onPress={() => setDismissed(true)}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    borderStartWidth: 4,
    borderStartColor: colors.primary,
    padding: spacing.md,
    gap: spacing.sm,
    ...shadows.level1,
  },
  bannerActive: {
    backgroundColor: statusColors.approvedBg,
    borderColor: colors.primary,
  },
  bannerMuted: {
    backgroundColor: colors.surface2,
    borderStartColor: colors.ink4,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: radii.pill,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  iconWrapActive: {
    backgroundColor: colors.surface1,
  },
  textCol: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  title: {
    fontFamily: fontFamilies.bodyBold,
    fontSize: typeScale.step0,
    color: colors.ink,
    textAlign: 'left',
  },
  activeTitle: {
    fontFamily: fontFamilies.bodyBold,
    fontSize: typeScale.step0,
    color: statusColors.approvedText,
    textAlign: 'left',
    includeFontPadding: false,
  },
  subtitle: {
    fontFamily: fontFamilies.body,
    fontSize: typeScale.stepMinus1,
    color: colors.ink2,
    textAlign: 'left',
    lineHeight: 18,
  },
  statusSubtle: {
    fontFamily: fontFamilies.body,
    fontSize: typeScale.stepMinus1,
    color: colors.ink3,
    textAlign: 'left',
    includeFontPadding: false,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  enableBtn: {
    flex: 1,
  },
  dismissIconBtn: {
    width: 32,
    height: 32,
    borderRadius: radii.pill,
    backgroundColor: colors.surface1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
});
