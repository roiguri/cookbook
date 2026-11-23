import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { IS_DTU_MODE } from './firebase-app';

export const ANDROID_NOTIFICATION_CHANNEL_ID = 'cookbook_default';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function ensureAndroidNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANDROID_NOTIFICATION_CHANNEL_ID, {
    name: 'עדכוני מתכונים',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    sound: 'default',
  });
}

export async function requestPushPermission(): Promise<boolean> {
  await ensureAndroidNotificationChannel();
  const existing = await Notifications.getPermissionsAsync();
  if (existing.status === 'granted') return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.status === 'granted';
}

export async function getCurrentPushPermissionStatus(): Promise<
  'granted' | 'denied' | 'undetermined'
> {
  const res = await Notifications.getPermissionsAsync();
  return res.status;
}

export async function getNativeDevicePushToken(deviceId: string): Promise<string | null> {
  if (IS_DTU_MODE) {
    // Deterministic DTU token for Android Emulator & iOS Simulator without Google Play / APNs certs
    return `dtu_${Platform.OS}_token_${deviceId}`;
  }
  if (!Device.isDevice) {
    return null;
  }
  try {
    const res = await Notifications.getDevicePushTokenAsync();
    return typeof res.data === 'string' ? res.data : String(res.data || '');
  } catch {
    return null;
  }
}

export function subscribeNotificationResponses(onUrl: (url: string) => void): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as Record<string, any> | undefined;
    const url = typeof data?.url === 'string' ? data.url : '';
    if (url) onUrl(url);
  });
  return () => sub.remove();
}

export async function getInitialNotificationUrl(): Promise<string | null> {
  const last = await Notifications.getLastNotificationResponseAsync();
  const data = last?.notification?.request?.content?.data as Record<string, any> | undefined;
  return typeof data?.url === 'string' ? data.url : null;
}
