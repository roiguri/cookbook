import { jest } from '@jest/globals';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const notifications = require('../../../functions/notifications.js');

const { buildPlatformMessages, sendNotificationToUsers, sendNotificationToRole } = notifications;

describe('functions/notifications — multi-platform FCM dispatch', () => {
  describe('buildPlatformMessages', () => {
    it('builds idiomatic per-platform payloads for web, android, and ios', () => {
      const devices = [
        { uid: 'u1', deviceId: 'd-web', token: 'tok-web', platform: 'web' },
        { uid: 'u1', deviceId: 'd-and', token: 'tok-and', platform: 'android' },
        { uid: 'u2', deviceId: 'd-ios', token: 'tok-ios', platform: 'ios' },
        { uid: 'u3', deviceId: 'd-bad', token: 'tok-bad', platform: 'unknown' },
        { uid: 'u4', deviceId: 'd-empty', token: '', platform: 'ios' },
      ];

      const batches = buildPlatformMessages(devices, {
        title: 'מתכון חדש ממתין לאישור',
        body: 'שקשוקה',
        collapseKey: 'recipe-approval',
        url: '/dashboard',
        data: { type: 'recipe-approval', recipeId: 'r-42', count: 3 },
      });

      expect(batches.map((b) => b.platform)).toEqual(['web', 'android', 'ios']);

      // Web: data-only (no top-level notification to avoid duplicate SW banners)
      const webBatch = batches[0];
      expect(webBatch.message.notification).toBeUndefined();
      expect(webBatch.message.tokens).toEqual(['tok-web']);
      expect(webBatch.message.data).toEqual({
        type: 'recipe-approval',
        recipeId: 'r-42',
        count: '3',
        title: 'מתכון חדש ממתין לאישור',
        body: 'שקשוקה',
        url: '/dashboard',
      });
      expect(webBatch.message.webpush).toEqual({
        headers: { Topic: 'recipe-approval' },
        fcmOptions: { link: '/dashboard' },
      });

      // Android: notification + high-priority channel + collapseKey + data
      const androidBatch = batches[1];
      expect(androidBatch.message.notification).toEqual({
        title: 'מתכון חדש ממתין לאישור',
        body: 'שקשוקה',
      });
      expect(androidBatch.message.tokens).toEqual(['tok-and']);
      expect(androidBatch.message.android).toEqual({
        priority: 'high',
        collapseKey: 'recipe-approval',
        notification: { channelId: 'cookbook_default' },
      });
      expect(androidBatch.message.data.url).toBe('/dashboard');

      // iOS: notification + APNs alert headers + sound + mutable-content + data
      const iosBatch = batches[2];
      expect(iosBatch.message.notification).toEqual({
        title: 'מתכון חדש ממתין לאישור',
        body: 'שקשוקה',
      });
      expect(iosBatch.message.tokens).toEqual(['tok-ios']);
      expect(iosBatch.message.apns).toEqual({
        headers: {
          'apns-push-type': 'alert',
          'apns-priority': '10',
          'apns-collapse-id': 'recipe-approval',
        },
        payload: {
          aps: {
            sound: 'default',
            'mutable-content': 1,
          },
        },
      });
    });

    it('chunks batches exceeding the 500-token FCM multicast limit', () => {
      const devices = Array.from({ length: 505 }, (_, i) => ({
        uid: `u${i}`,
        deviceId: `d${i}`,
        token: `tok-${i}`,
        platform: 'android',
      }));

      const batches = buildPlatformMessages(devices, { title: 'Hi', body: 'Body' });
      expect(batches).toHaveLength(2);
      expect(batches[0].message.tokens).toHaveLength(500);
      expect(batches[1].message.tokens).toHaveLength(5);
    });
  });

  describe('sendNotificationToUsers & sendNotificationToRole', () => {
    function makeMockDb(usersByRole, devicesByUid) {
      return {
        collection(name) {
          if (name !== 'users') throw new Error(`Unexpected collection ${name}`);
          return {
            doc(uid) {
              return {
                collection(sub) {
                  if (sub !== 'devices') throw new Error(`Unexpected subcollection ${sub}`);
                  return {
                    async get() {
                      return { docs: devicesByUid[uid] || [] };
                    },
                  };
                },
              };
            },
            where(_field, _op, role) {
              return {
                async get() {
                  return {
                    docs: (usersByRole[role] || []).map((id) => ({ id })),
                  };
                },
              };
            },
          };
        },
      };
    }

    function makeDeviceDoc(id, data) {
      const ref = { delete: jest.fn().mockResolvedValue() };
      return { id, data: () => data, ref };
    }

    it('reads users/{uid}/devices, fans out per platform, and prunes only permanently invalid tokens', async () => {
      const webDead = makeDeviceDoc('w1', { token: 'web-dead', platform: 'web' });
      const androidOk = makeDeviceDoc('a1', { token: 'and-ok', platform: 'android' });
      const androidTransient = makeDeviceDoc('a2', { token: 'and-temp', platform: 'android' });
      const iosDead = makeDeviceDoc('i1', { token: 'ios-dead', platform: 'ios' });

      const db = makeMockDb(
        { manager: ['m1', 'm2'] },
        {
          m1: [webDead, androidOk],
          m2: [androidTransient, iosDead],
        },
      );

      const messaging = {
        sendEachForMulticast: jest
          .fn()
          // Batch 1: web
          .mockResolvedValueOnce({
            successCount: 0,
            failureCount: 1,
            responses: [
              { success: false, error: { code: 'messaging/registration-token-not-registered' } },
            ],
          })
          // Batch 2: android (1 ok, 1 transient error -> must NOT prune transient)
          .mockResolvedValueOnce({
            successCount: 1,
            failureCount: 1,
            responses: [
              { success: true },
              { success: false, error: { code: 'messaging/internal-error' } },
            ],
          })
          // Batch 3: ios (permanent invalid token -> prune)
          .mockResolvedValueOnce({
            successCount: 0,
            failureCount: 1,
            responses: [
              { success: false, error: { code: 'messaging/invalid-registration-token' } },
            ],
          }),
      };

      const result = await sendNotificationToRole(
        'manager',
        { title: 'T', body: 'B', url: '/dashboard' },
        { db, messaging },
      );

      expect(messaging.sendEachForMulticast).toHaveBeenCalledTimes(3);
      expect(result).toEqual({ sent: 1, failed: 3, pruned: 2 });
      expect(webDead.ref.delete).toHaveBeenCalledTimes(1);
      expect(iosDead.ref.delete).toHaveBeenCalledTimes(1);
      expect(androidOk.ref.delete).not.toHaveBeenCalled();
      expect(androidTransient.ref.delete).not.toHaveBeenCalled();
    });

    it('returns zeros when no users or no valid devices exist', async () => {
      const messaging = { sendEachForMulticast: jest.fn() };
      const db = makeMockDb({}, { u1: [] });

      expect(
        await sendNotificationToUsers([], { title: 'T', body: 'B' }, { db, messaging }),
      ).toEqual({ sent: 0, failed: 0, pruned: 0 });
      expect(
        await sendNotificationToUsers(['u1'], { title: 'T', body: 'B' }, { db, messaging }),
      ).toEqual({ sent: 0, failed: 0, pruned: 0 });
      expect(messaging.sendEachForMulticast).not.toHaveBeenCalled();
    });

    it('routes outgoing batches to FCM_TWIN_URL when FUNCTIONS_EMULATOR=true', async () => {
      const origEmu = process.env.FUNCTIONS_EMULATOR;
      const origTwin = process.env.FCM_TWIN_URL;
      const origFetch = global.fetch;
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ successCount: 1, failureCount: 0, responses: [{ success: true }] }),
      });

      process.env.FUNCTIONS_EMULATOR = 'true';
      process.env.FCM_TWIN_URL = 'http://127.0.0.1:9202';
      global.fetch = fetchMock;

      try {
        const iosDoc = makeDeviceDoc('i1', { token: 'sim-ios-tok', platform: 'ios' });
        const db = makeMockDb({}, { m1: [iosDoc] });
        const messaging = { sendEachForMulticast: jest.fn() };

        const result = await sendNotificationToUsers(
          ['m1'],
          { title: 'Twin Test', body: 'Hello' },
          { db, messaging },
        );

        expect(result).toEqual({ sent: 1, failed: 0, pruned: 0 });
        expect(messaging.sendEachForMulticast).not.toHaveBeenCalled();
        expect(fetchMock).toHaveBeenCalledWith(
          'http://127.0.0.1:9202/send',
          expect.objectContaining({ method: 'POST' }),
        );
        const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(sentBody.platform).toBe('ios');
        expect(sentBody.message.tokens).toEqual(['sim-ios-tok']);
      } finally {
        if (origEmu === undefined) delete process.env.FUNCTIONS_EMULATOR;
        else process.env.FUNCTIONS_EMULATOR = origEmu;
        if (origTwin === undefined) delete process.env.FCM_TWIN_URL;
        else process.env.FCM_TWIN_URL = origTwin;
        global.fetch = origFetch;
      }
    });
  });
});
