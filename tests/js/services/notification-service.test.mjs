import { jest } from '@jest/globals';
import { deviceIdForToken, PUSH_PLATFORMS } from '@cookbook/core/push-devices';

import '../../common/mocks/firebase-firestore.mock.js';
import '../../common/mocks/firebase-service.mock.js';

const userServiceMocks = {
  registerDevice: jest.fn(),
  unregisterDevice: jest.fn(),
};

const loggerMocks = {
  captureError: jest.fn(),
};

jest.unstable_mockModule('src/js/services/users/user-service.js', () => ({
  UserService: userServiceMocks,
}));

jest.unstable_mockModule('src/js/services/logger.js', () => loggerMocks);

let NotificationService;

beforeEach(async () => {
  jest.resetModules();
  localStorage.clear();
  userServiceMocks.registerDevice.mockReset();
  userServiceMocks.unregisterDevice.mockReset();
  loggerMocks.captureError.mockReset();

  ({ NotificationService } = await import('src/js/services/users/notification-service.js'));
});

describe('NotificationService (users/{uid}/devices subcollection)', () => {
  it('stores a web device record with deterministic deviceId and platform="web"', async () => {
    userServiceMocks.registerDevice.mockResolvedValue();
    const svc = new NotificationService();
    const token = 'fcm-web-token-12345';

    const deviceId = await svc._storeDevice('u1', token);

    expect(deviceId).toBe(deviceIdForToken(token));
    expect(userServiceMocks.registerDevice).toHaveBeenCalledTimes(1);
    expect(userServiceMocks.registerDevice).toHaveBeenCalledWith(
      'u1',
      deviceIdForToken(token),
      expect.objectContaining({
        token,
        platform: PUSH_PLATFORMS.WEB,
        updatedAt: expect.anything(),
      }),
    );
  });

  it('unregisters the cached device doc via UserService.unregisterDevice and clears localStorage', async () => {
    userServiceMocks.unregisterDevice.mockResolvedValue();
    const svc = new NotificationService();
    const deviceId = deviceIdForToken('tok-signout');
    svc._writeCachedDevice({ deviceId, token: 'tok-signout' });

    await svc.unregisterCurrentDevice('u1');

    expect(userServiceMocks.unregisterDevice).toHaveBeenCalledWith('u1', deviceId);
    expect(svc._readCachedDevice()).toBeNull();
  });

  it('is a no-op when unregistering with no cached device or no uid', async () => {
    const svc = new NotificationService();
    await svc.unregisterCurrentDevice('u1');
    await svc.unregisterCurrentDevice('');
    expect(userServiceMocks.unregisterDevice).not.toHaveBeenCalled();
  });

  it('reports granted-registered when permission is granted and device is cached', async () => {
    const svc = new NotificationService();
    svc.isSupported = () => true;
    const origNotification = globalThis.Notification;
    globalThis.Notification = { permission: 'granted' };

    try {
      expect(await svc.getStatus()).toBe('granted-unregistered');
      svc._writeCachedDevice({ deviceId: 'abc123', token: 'tok' });
      expect(await svc.getStatus()).toBe('granted-registered');
    } finally {
      globalThis.Notification = origNotification;
    }
  });
});
