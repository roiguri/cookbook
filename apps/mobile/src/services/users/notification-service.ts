import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { deviceIdForToken } from '@cookbook/core/push-devices';
import { IS_DTU_MODE } from '../_firebase/firebase-app';
import {
  ANDROID_NOTIFICATION_CHANNEL_ID,
  ensureAndroidNotificationChannel,
  getCurrentPushPermissionStatus,
  getDeviceUserAgent,
  getInitialNotificationResponse,
  getNativeDevicePushToken,
  isPushSupported,
  requestPushPermission,
  subscribeForegroundNotifications,
  subscribeNotificationResponses,
  subscribePushTokenRefresh,
  unregisterNativePushToken,
  type IncomingPushPayload,
  type NativePushPlatform,
} from '../_firebase/messaging-adapter';
import { AuthService } from '../auth/auth-service';
import { captureError } from '../logger';
import { UserService } from './user-service';

export { ANDROID_NOTIFICATION_CHANNEL_ID, type IncomingPushPayload, type NativePushPlatform };

export type PushPermissionStatus =
  'unsupported' | 'denied' | 'default' | 'granted-unregistered' | 'granted-registered';

export interface PushOperationResult {
  ok: boolean;
  status: PushPermissionStatus;
  deviceId?: string;
  reason?: string;
}

export const PUSH_STATUS_ACTIVE_LABEL = 'התראות פעילות';

const DEVICE_STORAGE_PREFIX = 'cookbook:push_device_id:';

const activeDeviceCache = new Map<string, string>();
const statusListeners = new Set<() => void>();

function storageKeyForUser(uid: string): string {
  return `${DEVICE_STORAGE_PREFIX}${uid}`;
}

function resolvePlatform(): NativePushPlatform {
  return Platform.OS === 'ios' ? 'ios' : 'android';
}

function notifyStatusListeners(): void {
  for (const listener of Array.from(statusListeners)) {
    try {
      listener();
    } catch {
      // Ignore subscriber errors
    }
  }
}

async function readStoredDeviceId(uid: string): Promise<string | null> {
  if (!uid) return null;
  const cached = activeDeviceCache.get(uid);
  if (cached) return cached;
  try {
    const stored = await AsyncStorage.getItem(storageKeyForUser(uid));
    if (stored && stored.trim()) {
      activeDeviceCache.set(uid, stored.trim());
      return stored.trim();
    }
  } catch (err) {
    captureError(err, { service: 'notification', op: 'readStoredDeviceId', uid });
  }
  return null;
}

async function writeStoredDeviceId(uid: string, deviceId: string): Promise<void> {
  activeDeviceCache.set(uid, deviceId);
  try {
    await AsyncStorage.setItem(storageKeyForUser(uid), deviceId);
  } catch (err) {
    captureError(err, { service: 'notification', op: 'writeStoredDeviceId', uid });
  }
}

async function clearStoredDeviceId(uid: string): Promise<void> {
  activeDeviceCache.delete(uid);
  try {
    await AsyncStorage.removeItem(storageKeyForUser(uid));
  } catch {
    // Silent cleanup failure
  }
}

async function syncRefreshedToken(uid: string, newToken: string): Promise<void> {
  if (!uid || !newToken.trim()) return;
  const previousDeviceId = await readStoredDeviceId(uid);
  // Only rotate if this user explicitly opted in on this device
  if (!previousDeviceId) return;

  try {
    const nextDeviceId = deviceIdForToken(newToken);
    const platform = resolvePlatform();
    const ua = getDeviceUserAgent();

    await UserService.registerDevice(uid, nextDeviceId, {
      token: newToken,
      platform,
      ua,
    });

    if (previousDeviceId !== nextDeviceId) {
      await UserService.unregisterDevice(uid, previousDeviceId);
    }

    await writeStoredDeviceId(uid, nextDeviceId);
    notifyStatusListeners();
  } catch (err) {
    captureError(err, { service: 'notification', op: 'syncRefreshedToken', uid });
  }
}

export const NotificationService = {
  isSupported(): boolean {
    return isPushSupported();
  },

  async ensureChannel(): Promise<void> {
    await ensureAndroidNotificationChannel();
  },

  async getActiveDeviceId(uid: string): Promise<string | null> {
    return readStoredDeviceId(uid);
  },

  /**
   * Returns the exact 5-state push permission & registration status:
   * 'unsupported' | 'denied' | 'default' | 'granted-unregistered' | 'granted-registered'
   */
  async getStatus(uid?: string | null): Promise<PushPermissionStatus> {
    if (!this.isSupported()) {
      return 'unsupported';
    }

    const permission = await getCurrentPushPermissionStatus();
    if (permission === 'denied') {
      return 'denied';
    }

    const activeDeviceId = uid ? await readStoredDeviceId(uid) : null;
    if (permission === 'undetermined') {
      return IS_DTU_MODE && activeDeviceId ? 'granted-registered' : 'default';
    }

    return activeDeviceId ? 'granted-registered' : 'granted-unregistered';
  },

  /**
   * Requests OS notification permission, ensures the Android `cookbook_default`
   * channel exists, acquires the device token (real FCM/APNs on physical devices
   * or deterministic `dtu-fcm-${platform}-${uid}-device1` in DTU / Simulator),
   * and writes `users/{uid}/devices/{deviceId}` via 3-arg UserService.registerDevice.
   */
  async enable(uid: string): Promise<PushOperationResult> {
    if (!uid) {
      return { ok: false, status: 'default', reason: 'no-uid' };
    }
    if (!this.isSupported()) {
      return { ok: false, status: 'unsupported', reason: 'unsupported' };
    }

    try {
      await ensureAndroidNotificationChannel();

      const granted = await requestPushPermission();
      if (!granted) {
        const status = await this.getStatus(uid);
        notifyStatusListeners();
        return { ok: false, status, reason: status };
      }

      const token = await getNativeDevicePushToken(uid);
      if (!token) {
        return { ok: false, status: 'granted-unregistered', reason: 'no-token' };
      }

      const deviceId = deviceIdForToken(token);
      const platform = resolvePlatform();
      const ua = getDeviceUserAgent();

      await UserService.registerDevice(uid, deviceId, {
        token,
        platform,
        ua,
      });

      await writeStoredDeviceId(uid, deviceId);
      notifyStatusListeners();

      return {
        ok: true,
        status: 'granted-registered',
        deviceId,
      };
    } catch (err) {
      captureError(err, { service: 'notification', op: 'enable', uid });
      const status = await this.getStatus(uid);
      return { ok: false, status, reason: 'error' };
    }
  },

  /**
   * Alias matching Web NotificationService.requestPermissionAndRegister(uid).
   */
  async requestPermissionAndRegister(uid: string): Promise<PushOperationResult> {
    return this.enable(uid);
  },

  /**
   * Explicitly opts out on this device by deleting `users/{uid}/devices/{deviceId}`.
   */
  async disable(uid: string): Promise<PushOperationResult> {
    if (!uid) {
      return { ok: false, status: 'default', reason: 'no-uid' };
    }
    await this.unregisterCurrentDevice(uid);
    const status = await this.getStatus(uid);
    return { ok: true, status };
  },

  /**
   * Deletes the current device registration from `users/{uid}/devices/{deviceId}`
   * and clears cached AsyncStorage state. Registered as a before-sign-out hook so
   * signing out ALWAYS cleans up while request.auth.uid == uid is still valid.
   */
  async unregisterCurrentDevice(uid: string): Promise<void> {
    if (!uid) return;
    const deviceId = await readStoredDeviceId(uid);
    if (!deviceId) {
      await clearStoredDeviceId(uid);
      notifyStatusListeners();
      return;
    }

    try {
      await UserService.unregisterDevice(uid, deviceId);
      await unregisterNativePushToken();
    } catch (err) {
      captureError(err, { service: 'notification', op: 'unregisterCurrentDevice', uid });
    } finally {
      await clearStoredDeviceId(uid);
      notifyStatusListeners();
    }
  },

  subscribeStatusChange(listener: () => void): () => void {
    statusListeners.add(listener);
    return () => statusListeners.delete(listener);
  },

  subscribeForeground(onMessage: (payload: IncomingPushPayload) => void): () => void {
    return subscribeForegroundNotifications(onMessage);
  },

  subscribeNotificationTap(onTap: (url: string, payload: IncomingPushPayload) => void): () => void {
    return subscribeNotificationResponses(onTap);
  },

  async getInitialNotificationTap(): Promise<IncomingPushPayload | null> {
    return getInitialNotificationResponse();
  },

  subscribeTokenRefresh(uid: string): () => void {
    return subscribePushTokenRefresh((token) => {
      void syncRefreshedToken(uid, token);
    });
  },
};

// INV-P1-04 / P0: Always unregister the active device doc BEFORE Firebase Auth signs out.
AuthService.registerBeforeSignOutHook(async (uid: string) => {
  await NotificationService.unregisterCurrentDevice(uid);
});

export default NotificationService;
