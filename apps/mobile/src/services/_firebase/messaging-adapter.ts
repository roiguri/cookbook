import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { IS_DTU_MODE } from './firebase-app';

export const ANDROID_NOTIFICATION_CHANNEL_ID = 'cookbook_default';

export type NativePushPlatform = 'android' | 'ios';

export interface IncomingPushPayload {
  id: string;
  title: string;
  body: string;
  url: string;
  data: Record<string, string>;
}

const DEFAULT_NOTIFICATION_TITLE = 'התראה חדשה';
const DEFAULT_NOTIFICATION_URL = '/(tabs)/dashboard';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export function getNativePushPlatform(): NativePushPlatform {
  return Platform.OS === 'ios' ? 'ios' : 'android';
}

export function isPushSupported(): boolean {
  return Platform.OS === 'android' || Platform.OS === 'ios';
}

/**
 * Builds a PII-free device label (<= 200 chars) for users/{uid}/devices/{deviceId}.ua.
 * Intentionally avoids Device.deviceName which can contain personal names on iOS.
 */
export function getDeviceUserAgent(): string {
  const platform = getNativePushPlatform();
  const model = Device.modelName || Device.brand || platform;
  const osName = Device.osName || (platform === 'ios' ? 'iOS' : 'Android');
  const osVersion = Device.osVersion || String(Platform.Version || '');
  const versionPart = osVersion ? ` ${osVersion}` : '';
  return `CookbookMobile/${platform} (${model}; ${osName}${versionPart})`.slice(0, 200);
}

function extractNotificationPayload(notification: Notifications.Notification): IncomingPushPayload {
  const content = notification.request?.content;
  const rawData =
    content?.data && typeof content.data === 'object'
      ? (content.data as Record<string, unknown>)
      : {};

  const data: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawData)) {
    if (value === null || value === undefined) continue;
    data[key] = typeof value === 'string' ? value : String(value);
  }

  const title =
    (typeof content?.title === 'string' && content.title.trim()) ||
    (typeof data.title === 'string' && data.title.trim()) ||
    DEFAULT_NOTIFICATION_TITLE;

  const body =
    (typeof content?.body === 'string' && content.body.trim()) ||
    (typeof data.body === 'string' && data.body.trim()) ||
    '';

  const url = (typeof data.url === 'string' && data.url.trim()) || DEFAULT_NOTIFICATION_URL;

  return {
    id: notification.request?.identifier || `${Date.now()}`,
    title,
    body,
    url,
    data,
  };
}

export async function ensureAndroidNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync(ANDROID_NOTIFICATION_CHANNEL_ID, {
      name: 'עדכוני מתכונים',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      sound: 'default',
    });
  } catch {
    // Channel setup is best-effort on non-Android or restricted runtimes
  }
}

export async function requestPushPermission(): Promise<boolean> {
  await ensureAndroidNotificationChannel();
  try {
    const existing = await Notifications.getPermissionsAsync();
    if (existing.status === 'granted') return true;
    const requested = await Notifications.requestPermissionsAsync();
    return requested.status === 'granted';
  } catch {
    // In DTU E2E environments without native notification permissions bridge, keep deterministic
    return IS_DTU_MODE;
  }
}

export async function getCurrentPushPermissionStatus(): Promise<
  'granted' | 'denied' | 'undetermined'
> {
  try {
    const res = await Notifications.getPermissionsAsync();
    if (res.status === 'granted' || res.status === 'denied') {
      return res.status;
    }
    return 'undetermined';
  } catch {
    return 'undetermined';
  }
}

export async function getNativeDevicePushToken(uid: string): Promise<string | null> {
  const platform = getNativePushPlatform();
  if (IS_DTU_MODE || !Device.isDevice) {
    // Deterministic DTU / Simulator token so deviceIdForToken(token) is stable
    // and users/{uid}/devices/{deviceId} + fcm-twin flows are 100% testable without APNs certs.
    return `dtu-fcm-${platform}-${uid}-device1`;
  }
  try {
    const res = await Notifications.getDevicePushTokenAsync();
    const raw = typeof res.data === 'string' ? res.data.trim() : String(res.data || '').trim();
    return raw || null;
  } catch {
    return null;
  }
}

export async function unregisterNativePushToken(): Promise<void> {
  if (IS_DTU_MODE || !Device.isDevice) return;
  try {
    await Notifications.unregisterForNotificationsAsync();
  } catch {
    // Best-effort cleanup; server-side pruning handles any stale FCM tokens
  }
}

export function subscribeForegroundNotifications(
  onMessage: (payload: IncomingPushPayload) => void,
): () => void {
  const sub = Notifications.addNotificationReceivedListener((notification) => {
    onMessage(extractNotificationPayload(notification));
  });
  return () => sub.remove();
}

export function subscribeNotificationResponses(
  onUrl: (url: string, payload: IncomingPushPayload) => void,
): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const payload = extractNotificationPayload(response.notification);
    onUrl(payload.url, payload);
  });
  return () => sub.remove();
}

export async function getInitialNotificationResponse(): Promise<IncomingPushPayload | null> {
  try {
    const last = await Notifications.getLastNotificationResponseAsync();
    if (!last?.notification) return null;
    const payload = extractNotificationPayload(last.notification);
    await Notifications.clearLastNotificationResponseAsync().catch(() => {});
    return payload;
  } catch {
    return null;
  }
}

export async function getInitialNotificationUrl(): Promise<string | null> {
  const payload = await getInitialNotificationResponse();
  return payload ? payload.url : null;
}

export function subscribePushTokenRefresh(onToken: (token: string) => void): () => void {
  const sub = Notifications.addPushTokenListener((deviceToken) => {
    const raw =
      typeof deviceToken?.data === 'string'
        ? deviceToken.data.trim()
        : String(deviceToken?.data || '').trim();
    if (raw) {
      onToken(raw);
    }
  });
  return () => sub.remove();
}
