/**
 * Generic multi-platform notification helper for Cloud Functions.
 *
 * Channel-agnostic API for sending notifications to users. Backed by Firebase
 * Cloud Messaging (FCM), reading device registrations from the
 * `users/{uid}/devices/{deviceId}` subcollection:
 *   { token: string, platform: 'web' | 'android' | 'ios', ua?: string, updatedAt: Timestamp }
 *
 * Public API:
 *   - sendNotificationToUsers(uids, payload, deps?): Send to specific user IDs.
 *   - sendNotificationToRole(role, payload, deps?):  Send to all users with a role.
 *   - buildPlatformMessages(devices, payload):       Pure helper for per-platform FCM messages.
 *
 * payload shape:
 *   {
 *     title:        string,
 *     body:         string,
 *     data?:        object  // string-valued; merged into FCM data payload
 *     collapseKey?: string  // groups notifications so a newer one replaces older
 *     url?:         string  // deep link opened on notification tap (default '/dashboard')
 *     channelId?:   string  // Android notification channel (default 'cookbook_default')
 *   }
 */
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

const SUPPORTED_PLATFORMS = ['web', 'android', 'ios'];
const FCM_MULTICAST_BATCH_LIMIT = 500;
const DEFAULT_ANDROID_CHANNEL = 'cookbook_default';

const PERMANENT_TOKEN_ERRORS = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

// FCM data payload must contain only string values.
function stringifyData(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null) continue;
    out[k] = typeof v === 'string' ? v : String(v);
  }
  return out;
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Partition device entries by platform (`web`, `android`, `ios`) and build
 * idiomatic FCM multicast message objects (chunked to <= 500 tokens each).
 *
 * - `web`: data-only + `webpush` so the Service Worker remains the single
 *   display source without duplicate browser banners.
 * - `android`: `notification` + `android` (high priority, channelId, collapseKey)
 *   + `data` so background/terminated devices display system alerts and deep-link.
 * - `ios`: `notification` + `apns` (alert, sound, mutable-content, apns-collapse-id)
 *   + `data` so APNs displays banners and routes taps cleanly.
 *
 * @param {Array<{ uid: string, deviceId: string, token: string, platform: string, ref?: Object }>} devices
 * @param {Object} payload
 * @returns {Array<{ platform: string, devices: Array, message: Object }>}
 */
function buildPlatformMessages(devices, payload) {
  const url = payload.url || '/dashboard';
  const data = stringifyData({
    ...(payload.data || {}),
    title: payload.title,
    body: payload.body,
    url,
  });

  const byPlatform = { web: [], android: [], ios: [] };
  for (const device of devices || []) {
    if (!device || typeof device.token !== 'string' || !device.token) continue;
    if (!SUPPORTED_PLATFORMS.includes(device.platform)) continue;
    byPlatform[device.platform].push(device);
  }

  const batches = [];

  // Web: data-only + webpush headers/fcmOptions
  for (const group of chunkArray(byPlatform.web, FCM_MULTICAST_BATCH_LIMIT)) {
    const webpush = {};
    if (payload.collapseKey) webpush.headers = { Topic: payload.collapseKey };
    if (url) webpush.fcmOptions = { link: url };

    batches.push({
      platform: 'web',
      devices: group,
      message: {
        data,
        tokens: group.map((d) => d.token),
        webpush,
      },
    });
  }

  // Android: native notification + high-priority channel + data
  for (const group of chunkArray(byPlatform.android, FCM_MULTICAST_BATCH_LIMIT)) {
    const android = {
      priority: 'high',
      notification: {
        channelId: payload.channelId || DEFAULT_ANDROID_CHANNEL,
      },
    };
    if (payload.collapseKey) android.collapseKey = payload.collapseKey;

    batches.push({
      platform: 'android',
      devices: group,
      message: {
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data,
        tokens: group.map((d) => d.token),
        android,
      },
    });
  }

  // iOS: native notification + APNs alert headers & sound + data
  for (const group of chunkArray(byPlatform.ios, FCM_MULTICAST_BATCH_LIMIT)) {
    const apnsHeaders = {
      'apns-push-type': 'alert',
      'apns-priority': '10',
    };
    if (payload.collapseKey) apnsHeaders['apns-collapse-id'] = payload.collapseKey;

    batches.push({
      platform: 'ios',
      devices: group,
      message: {
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data,
        tokens: group.map((d) => d.token),
        apns: {
          headers: apnsHeaders,
          payload: {
            aps: {
              sound: 'default',
              'mutable-content': 1,
            },
          },
        },
      },
    });
  }

  return batches;
}

/**
 * In the local Software Factory DTU (`FUNCTIONS_EMULATOR=true` + `FCM_TWIN_URL`),
 * forward outgoing FCM batches to the local FCM Twin instead of hitting real FCM.
 */
async function dispatchBatch(batch, messaging) {
  if (
    process.env.FUNCTIONS_EMULATOR === 'true' &&
    process.env.FCM_TWIN_URL &&
    typeof global.fetch === 'function'
  ) {
    const res = await global.fetch(`${process.env.FCM_TWIN_URL.replace(/\/$/, '')}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: batch.platform,
        message: batch.message,
      }),
    });
    if (!res.ok) {
      throw new Error(`FCM twin returned HTTP ${res.status}`);
    }
    return await res.json();
  }
  return await messaging.sendEachForMulticast(batch.message);
}

async function sendNotificationToUsers(uids, payload, deps) {
  if (!Array.isArray(uids) || uids.length === 0) {
    return { sent: 0, failed: 0, pruned: 0 };
  }

  const db = (deps && deps.db) || getFirestore();
  const messaging = (deps && deps.messaging) || getMessaging();

  const deviceSnapshots = await Promise.all(
    uids.map((uid) => db.collection('users').doc(uid).collection('devices').get()),
  );

  const devices = [];
  deviceSnapshots.forEach((snap, idx) => {
    const uid = uids[idx];
    for (const docSnap of snap.docs) {
      const data = docSnap.data() || {};
      if (typeof data.token !== 'string' || !data.token) continue;
      if (!SUPPORTED_PLATFORMS.includes(data.platform)) continue;
      devices.push({
        uid,
        deviceId: docSnap.id,
        token: data.token,
        platform: data.platform,
        ref: docSnap.ref,
      });
    }
  });

  if (devices.length === 0) {
    return { sent: 0, failed: 0, pruned: 0 };
  }

  const batches = buildPlatformMessages(devices, payload);
  let sent = 0;
  let failed = 0;
  const deadRefs = [];

  for (const batch of batches) {
    const response = await dispatchBatch(batch, messaging);
    sent += response.successCount || 0;
    failed += response.failureCount || 0;

    const responses = Array.isArray(response.responses) ? response.responses : [];
    responses.forEach((res, i) => {
      if (res && res.success) return;
      const code = res && res.error && res.error.code;
      if (PERMANENT_TOKEN_ERRORS.has(code) && batch.devices[i] && batch.devices[i].ref) {
        deadRefs.push(batch.devices[i]);
      }
    });
  }

  let pruned = 0;
  if (deadRefs.length > 0) {
    await Promise.all(
      deadRefs.map(async (device) => {
        try {
          await device.ref.delete();
          pruned += 1;
        } catch (err) {
          console.warn(
            `[notifications] prune failed for ${device.uid}/${device.deviceId}:`,
            err.message,
          );
        }
      }),
    );
  }

  return { sent, failed, pruned };
}

async function sendNotificationToRole(role, payload, deps) {
  if (!role) return { sent: 0, failed: 0, pruned: 0 };
  const db = (deps && deps.db) || getFirestore();
  const snap = await db.collection('users').where('role', '==', role).get();
  const uids = snap.docs.map((d) => d.id);
  return sendNotificationToUsers(uids, payload, deps);
}

module.exports = {
  SUPPORTED_PLATFORMS,
  FCM_MULTICAST_BATCH_LIMIT,
  buildPlatformMessages,
  sendNotificationToUsers,
  sendNotificationToRole,
};
