/**
 * NotificationService - Generic Web Push Notification Manager
 *
 * Channel-agnostic interface for managing push notifications. Currently backed
 * by Firebase Cloud Messaging (FCM), but the public API is intentionally
 * decoupled from the underlying channel so additional channels (email, in-app)
 * can be layered in later without touching call sites.
 *
 * The service is not tied to any specific user role or notification type.
 * Tokens are stored on `users/{uid}.fcmTokens` (array of { token, ua, createdAt }),
 * so any future notification type can target any user.
 *
 * Public API:
 *   - init(): One-time setup of FCM + service worker. Idempotent. Call on app start.
 *   - isSupported(): Whether the current browser supports push notifications.
 *   - getStatus(): One of 'unsupported' | 'denied' | 'default' | 'granted-unregistered' | 'granted-registered'.
 *   - requestPermissionAndRegister(uid): Call from a user gesture. Requests
 *       permission, acquires a token, and stores it on the user's doc.
 *   - unregisterCurrentDevice(uid): Removes this device's token from the user's doc.
 *       Called on sign-out.
 */
import { getFirebaseApp } from '../_firebase/firebase-service.js';
import { Timestamp } from 'firebase/firestore';
import { UserService } from './user-service.js';
import { captureError } from '../logger.js';

const SW_PATH = '/firebase-messaging-sw.js';
const TOKEN_CACHE_KEY = 'mcb_fcm_token_v1';

class NotificationService {
  constructor() {
    this._initialized = false;
    this._messaging = null;
    this._swRegistration = null;
    this._currentToken = null;
    this._vapidKey = null;
    this._initPromise = null;
  }

  isSupported() {
    return (
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'Notification' in window &&
      'PushManager' in window
    );
  }

  /**
   * One-time setup. Registers the FCM service worker and primes the messaging
   * instance. Safe to call multiple times — returns the same in-flight promise.
   *
   * Does NOT request permission or register a token; that requires a user
   * gesture and is handled by requestPermissionAndRegister().
   */
  init() {
    if (this._initPromise) return this._initPromise;
    if (!this.isSupported()) {
      this._initPromise = Promise.resolve(false);
      return this._initPromise;
    }

    this._initPromise = (async () => {
      try {
        this._vapidKey = import.meta.env.VITE_FCM_VAPID_KEY;
        if (!this._vapidKey) {
          // No VAPID key configured — push notifications cannot work.
          // Init silently no-ops so the rest of the app keeps functioning.
          console.warn(
            '[notifications] VITE_FCM_VAPID_KEY is not set; push notifications disabled.',
          );
          return false;
        }

        // Register the messaging SW separately from the existing caching SW.
        // Pass Firebase config via URL query params so the SW can initialize
        // without us shipping config in a static file.
        const iconEnv = import.meta.env.VITE_ICON_PATH || 'prod';
        const params = new URLSearchParams({
          apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
          authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
          projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
          storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
          messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
          appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
          badgePath: `/img/icon/${iconEnv}/wooden-spoon-32.png`,
        });
        this._swRegistration = await navigator.serviceWorker.register(
          `${SW_PATH}?${params.toString()}`,
          { scope: '/firebase-cloud-messaging-push-scope' },
        );

        const {
          getMessaging,
          isSupported: fcmIsSupported,
          onMessage,
        } = await import('firebase/messaging');
        if (!(await fcmIsSupported())) {
          console.warn('[notifications] FCM not supported on this browser.');
          return false;
        }
        this._messaging = getMessaging(getFirebaseApp());

        // Foreground message handler. FCM does not auto-display notifications
        // when the tab is focused — it calls onMessage instead. We route the
        // display through the same SW registration as the background path so
        // the SW's notificationclick handler manages navigation uniformly.
        onMessage(this._messaging, (payload) => {
          if (!this._swRegistration) return;
          const data = payload.data || {};
          const title = data.title || 'Our Kitchen Chronicles';
          this._swRegistration.showNotification(title, {
            body: data.body || '',
            icon: '/img/notification-recipe.png',
            badge: `/img/icon/${iconEnv}/wooden-spoon-32.png`,
            data,
            tag: data.tag || data.type || 'default',
          });
        });

        // Cache last-known token so we can unregister on sign-out even if
        // getToken() can't be called in time (e.g. permission revoked).
        this._currentToken = localStorage.getItem(TOKEN_CACHE_KEY) || null;

        this._initialized = true;
        return true;
      } catch (error) {
        console.error('[notifications] init failed:', error);
        captureError(error, { service: 'notification', op: 'init' });
        return false;
      }
    })();

    return this._initPromise;
  }

  /**
   * Returns the current notification status. Useful for UI gating
   * (e.g. showing or hiding an "enable notifications" banner).
   *
   * @returns {Promise<'unsupported'|'denied'|'default'|'granted-unregistered'|'granted-registered'>}
   */
  async getStatus() {
    if (!this.isSupported()) return 'unsupported';
    if (Notification.permission === 'denied') return 'denied';
    if (Notification.permission === 'default') return 'default';
    // permission === 'granted'
    return this._currentToken ? 'granted-registered' : 'granted-unregistered';
  }

  /**
   * Requests browser notification permission and registers an FCM token for
   * the current device against the given user. MUST be called from a user
   * gesture (button click) — browsers block requestPermission() otherwise.
   *
   * @param {string} uid - User ID to associate the token with.
   * @returns {Promise<{ ok: boolean, reason?: string }>}
   */
  async requestPermissionAndRegister(uid) {
    if (!uid) return { ok: false, reason: 'no-uid' };
    const ready = await this.init();
    if (!ready) return { ok: false, reason: 'not-supported' };

    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return { ok: false, reason: permission };

      const { getToken } = await import('firebase/messaging');
      const token = await getToken(this._messaging, {
        vapidKey: this._vapidKey,
        serviceWorkerRegistration: this._swRegistration,
      });
      if (!token) return { ok: false, reason: 'no-token' };

      await this._storeToken(uid, token);
      this._currentToken = token;
      localStorage.setItem(TOKEN_CACHE_KEY, token);
      return { ok: true };
    } catch (error) {
      console.error('[notifications] requestPermissionAndRegister failed:', error);
      captureError(error, { service: 'notification', op: 'requestPermissionAndRegister', uid });
      return { ok: false, reason: 'error' };
    }
  }

  /**
   * Removes the current device's token from the user's doc. Called on sign-out
   * to keep tokens fresh and avoid sending pushes to a device the user no
   * longer wants to receive on.
   *
   * @param {string} uid - User ID to remove the token from.
   */
  async unregisterCurrentDevice(uid) {
    const token = this._currentToken || localStorage.getItem(TOKEN_CACHE_KEY);
    if (!token || !uid) return;
    try {
      // We don't know the full token object shape on the server, so we remove
      // any entry with this token by writing back all-but-this-token. Cheaper:
      // store the canonical entry locally and remove that exact object via
      // UserService (which wraps arrayRemove).
      const cachedEntry = this._readCachedEntry();
      if (cachedEntry) {
        await UserService.removeFromArrayField(uid, 'fcmTokens', cachedEntry);
      }
      // Best-effort: also delete the token from FCM itself.
      try {
        const { deleteToken } = await import('firebase/messaging');
        if (this._messaging) await deleteToken(this._messaging);
      } catch (_) {
        // silent: FCM deleteToken failed; server-side pruning will catch dead tokens later
      }
    } catch (error) {
      console.warn('[notifications] unregisterCurrentDevice failed:', error);
      captureError(error, { service: 'notification', op: 'unregisterCurrentDevice', uid });
    } finally {
      this._currentToken = null;
      localStorage.removeItem(TOKEN_CACHE_KEY);
      localStorage.removeItem(`${TOKEN_CACHE_KEY}_entry`);
    }
  }

  async _storeToken(uid, token) {
    const entry = {
      token,
      ua: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 200) : '',
      createdAt: Timestamp.now(),
    };
    await UserService.addToArrayField(uid, 'fcmTokens', entry);
    localStorage.setItem(`${TOKEN_CACHE_KEY}_entry`, JSON.stringify(entry));
  }

  _readCachedEntry() {
    try {
      const raw = localStorage.getItem(`${TOKEN_CACHE_KEY}_entry`);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      // Re-hydrate the Timestamp so arrayRemove matches the stored object.
      if (parsed.createdAt && typeof parsed.createdAt === 'object') {
        parsed.createdAt = new Timestamp(parsed.createdAt.seconds, parsed.createdAt.nanoseconds);
      }
      return parsed;
    } catch (error) {
      captureError(error, { service: 'notification', op: '_readCachedEntry' });
      return null;
    }
  }
}

const notificationService = new NotificationService();

export { NotificationService, notificationService as default };
