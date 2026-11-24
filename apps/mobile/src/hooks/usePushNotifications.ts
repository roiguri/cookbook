import { useCallback, useEffect, useRef, useState } from 'react';
import { router, useRootNavigationState, type Href } from 'expo-router';
import { useSession } from '@/context/SessionContext';
import { captureError } from '@/services/logger';
import {
  NotificationService,
  type IncomingPushPayload,
} from '@/services/users/notification-service';
import { resolveAppRoute } from './useDeepLinks';

const FOREGROUND_BANNER_AUTO_DISMISS_MS = 6500;
const FALLBACK_DASHBOARD_HREF = '/(tabs)/dashboard' as Href;

export interface UsePushNotificationsResult {
  foregroundNotification: IncomingPushPayload | null;
  pressForegroundNotification: () => void;
  dismissForegroundNotification: () => void;
}

/**
 * Coordinates native push notification lifecycle inside the authenticated app shell:
 * - Creates the Android high-importance `cookbook_default` channel on startup.
 * - Keeps the device token synced on OS token rotation while signed in.
 * - Surfaces foreground notifications via `<PushForegroundBanner />` (`push-foreground-banner`).
 * - Handles background & cold-start notification taps, deferring navigation until
 *   `SessionContext.loading === false` so role-gated routes like `/dashboard` never
 *   prematurely redirect to `/home` during auth hydration.
 */
export function usePushNotifications(): UsePushNotificationsResult {
  const { user, loading: sessionLoading } = useSession();
  const rootNavState = useRootNavigationState();

  const [foregroundNotification, setForegroundNotification] = useState<IncomingPushPayload | null>(
    null,
  );
  const [pendingTapUrl, setPendingTapUrl] = useState<string | null>(null);

  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handledTapIdsRef = useRef<Set<string>>(new Set());
  const initialCheckedRef = useRef(false);

  const navReady = Boolean(rootNavState?.key);

  const clearDismissTimer = useCallback(() => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  }, []);

  const dismissForegroundNotification = useCallback(() => {
    clearDismissTimer();
    setForegroundNotification(null);
  }, [clearDismissTimer]);

  const queueTapNavigation = useCallback((rawUrl?: string | null) => {
    const target =
      typeof rawUrl === 'string' && rawUrl.trim() ? rawUrl.trim() : '/(tabs)/dashboard';
    setPendingTapUrl(target);
  }, []);

  const pressForegroundNotification = useCallback(() => {
    const targetUrl = foregroundNotification?.url || '/(tabs)/dashboard';
    dismissForegroundNotification();
    queueTapNavigation(targetUrl);
  }, [dismissForegroundNotification, foregroundNotification?.url, queueTapNavigation]);

  // 1. Ensure Android `cookbook_default` notification channel exists on startup
  useEffect(() => {
    NotificationService.ensureChannel().catch((err) => {
      captureError(err, { service: 'push', op: 'ensureChannel' });
    });
  }, []);

  // 2. Listen for OS push token rotations while signed in
  useEffect(() => {
    if (!user?.uid) return;
    return NotificationService.subscribeTokenRefresh(user.uid);
  }, [user?.uid]);

  // 3. Subscribe to foreground notifications + background/cold-start notification taps
  useEffect(() => {
    let active = true;

    const unsubForeground = NotificationService.subscribeForeground((payload) => {
      if (!active) return;
      clearDismissTimer();
      setForegroundNotification(payload);
      dismissTimerRef.current = setTimeout(() => {
        setForegroundNotification(null);
        dismissTimerRef.current = null;
      }, FOREGROUND_BANNER_AUTO_DISMISS_MS);
    });

    const unsubTap = NotificationService.subscribeNotificationTap((url, payload) => {
      if (!active) return;
      if (payload.id && handledTapIdsRef.current.has(payload.id)) {
        return;
      }
      if (payload.id) {
        handledTapIdsRef.current.add(payload.id);
      }
      dismissForegroundNotification();
      queueTapNavigation(url || '/(tabs)/dashboard');
    });

    if (!initialCheckedRef.current) {
      initialCheckedRef.current = true;
      NotificationService.getInitialNotificationTap()
        .then((initialPayload) => {
          if (!active || !initialPayload) return;
          if (initialPayload.id) {
            if (handledTapIdsRef.current.has(initialPayload.id)) return;
            handledTapIdsRef.current.add(initialPayload.id);
          }
          queueTapNavigation(initialPayload.url || '/(tabs)/dashboard');
        })
        .catch((err) => {
          captureError(err, { service: 'push', op: 'getInitialNotificationTap' });
        });
    }

    return () => {
      active = false;
      clearDismissTimer();
      unsubForeground();
      unsubTap();
    };
  }, [clearDismissTimer, dismissForegroundNotification, queueTapNavigation]);

  // 4. Execute deferred notification tap navigation strictly after nav + auth hydration
  useEffect(() => {
    if (!pendingTapUrl || !navReady || sessionLoading) return;

    const targetUrl = pendingTapUrl;
    setPendingTapUrl(null);

    try {
      const resolved = resolveAppRoute(targetUrl);
      router.push(resolved ? resolved.href : FALLBACK_DASHBOARD_HREF);
    } catch (err) {
      captureError(err, { service: 'push', op: 'navigateFromNotification' });
    }
  }, [pendingTapUrl, navReady, sessionLoading]);

  return {
    foregroundNotification,
    pressForegroundNotification,
    dismissForegroundNotification,
  };
}
